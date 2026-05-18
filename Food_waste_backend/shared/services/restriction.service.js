const pool = require("../config/db");
const logger = require("../utils/logger");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");

const DAY_MS = 24 * 60 * 60 * 1000;
const RECOVERY_STREAK = 3;

const USER_DEPOSIT_PERCENT = {
  3: 0.25,
  4: 0.5,
  5: 0.75,
  6: 1,
};

function addHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function addDays(days) {
  return new Date(Date.now() + days * DAY_MS);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function activeUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date > new Date() ? date : null;
}

function policyFromUser(user, depositAmount = 0) {
  const bannedUntil = activeUntil(user.banned_until);
  const cooldownUntil = activeUntil(user.cooldown_until);
  const requiresDeposit =
    Boolean(user.requires_reliability_deposit) || asNumber(depositAmount) > 0;

  return {
    canReserve: !bannedUntil && !cooldownUntil,
    canTakeTask: !bannedUntil && !cooldownUntil,
    canList: !bannedUntil && !cooldownUntil,
    requiresDeposit,
    depositAmount: requiresDeposit ? asNumber(depositAmount) : 0,
    restrictionLevel: asNumber(user.restriction_level),
    bannedUntil,
    cooldownUntil,
    restrictionReason: user.restriction_reason || null,
    restrictionType: user.restriction_type || null,
    trustScore: asNumber(user.trust_score, 100),
  };
}

function calculateDepositForRole(role, level, foodCost = 0) {
  const normalizedRole = role === "ngo" ? "ngo" : "user";

  if (normalizedRole === "ngo") {
    if (level <= 1) return 0;
    if (level === 2) return 100;
    if (level === 3) return 125;
    if (level === 4) return 250;
    return 500;
  }

  if (level <= 1) return 0;
  if (level === 2) return 20;

  const percent = USER_DEPOSIT_PERCENT[Math.min(level, 6)] || 1;
  return Math.max(20, Math.ceil(asNumber(foodCost) * percent));
}

async function getUserForUpdate(client, userId) {
  await ensureRestrictionSchema(client);
  const result = await client.query(
    `
    SELECT id, role, penalty_count, banned_until, cooldown_until,
           reliability_deposit_amount, requires_reliability_deposit,
           restriction_level, restriction_reason, restriction_type,
           trust_score, successful_pickups_count,
           total_successful_pickups, total_failed_pickups
    FROM users
    WHERE id=$1
    FOR UPDATE
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function getReservationPolicy({ client = pool, userId, role, foodCost = 0 }) {
  await ensureRestrictionSchema(client);
  const result = await client.query(
    `
    SELECT id, role, penalty_count, banned_until, cooldown_until,
           reliability_deposit_amount, requires_reliability_deposit,
           restriction_level, restriction_reason, restriction_type,
           trust_score
    FROM users
    WHERE id=$1
    `,
    [userId]
  );
  const user = result.rows[0] || { role, restriction_level: 0 };
  const level = asNumber(user.restriction_level);
  const depositAmount = calculateDepositForRole(role || user.role, level, foodCost);
  return policyFromUser(user, depositAmount);
}

function getEscalationFor(role, nextLevel, foodCost = 0, reason = null) {
  const update = {
    restriction_level: nextLevel,
    restriction_reason: reason,
    restriction_type: role,
    banned_until: null,
    cooldown_until: null,
    requires_reliability_deposit: false,
    reliability_deposit_amount: 0,
  };

  if (role === "volunteer") {
    if (nextLevel === 2) update.cooldown_until = addHours(24);
    if (nextLevel === 3) update.banned_until = addDays(3);
    if (nextLevel === 4) update.banned_until = addDays(7);
    if (nextLevel === 5) update.banned_until = addDays(30);
    if (nextLevel >= 6) {
      update.banned_until = addDays(3650);
      update.restriction_reason = "Permanent volunteer suspension candidate: " + reason;
    }
    return update;
  }

  if (role === "provider") {
    if (nextLevel === 2) update.cooldown_until = addHours(24);
    if (nextLevel === 3) update.cooldown_until = addDays(3);
    if (nextLevel === 4) update.cooldown_until = addDays(7);
    if (nextLevel >= 5) {
      update.cooldown_until = addDays(7);
      update.restriction_reason = "Provider moderation review required: " + reason;
    }
    if (nextLevel >= 6) update.banned_until = addDays(3650);
    return update;
  }

  const depositAmount = calculateDepositForRole(role, nextLevel, foodCost);
  update.requires_reliability_deposit = depositAmount > 0;
  update.reliability_deposit_amount = depositAmount;

  if (role === "ngo") {
    if (nextLevel === 5) update.cooldown_until = addHours(24);
    if (nextLevel === 6) update.banned_until = addDays(3);
    if (nextLevel >= 7) update.restriction_reason = "NGO manual review required: " + reason;
    if (nextLevel >= 8) update.banned_until = addDays(3650);
    return update;
  }

  if (nextLevel === 4) update.cooldown_until = addHours(24);
  if (nextLevel === 5) update.banned_until = addDays(3);
  if (nextLevel === 6) update.banned_until = addDays(7);
  if (nextLevel >= 7) {
    update.banned_until = addDays(3650);
    update.restriction_reason = "Permanent suspension candidate: " + reason;
  }
  return update;
}

async function recordViolation({
  client,
  userId,
  role,
  reservationId = null,
  reason,
  foodCost = 0,
}) {
  const user = await getUserForUpdate(client, userId);
  if (!user) return null;

  const effectiveRole = role || user.role || "user";
  const nextLevel = asNumber(user.restriction_level) + 1;
  const escalation = getEscalationFor(effectiveRole, nextLevel, foodCost, reason);

  await client.query(
    `
    INSERT INTO penalties (user_id, reservation_id, reason)
    VALUES ($1,$2,$3)
    `,
    [userId, reservationId, reason]
  );

  await client.query(
    `
    UPDATE users
    SET penalty_count = COALESCE(penalty_count, 0) + 1,
        last_penalty_at = NOW(),
        total_failed_pickups = COALESCE(total_failed_pickups, 0) + 1,
        successful_pickups_count = 0,
        trust_score = GREATEST(COALESCE(trust_score, 100) - 15, 0),
        restriction_level = $2,
        restriction_reason = $3,
        restriction_type = $4,
        banned_until = $5,
        cooldown_until = $6,
        requires_reliability_deposit = $7,
        reliability_deposit_amount = $8
    WHERE id=$1
    `,
    [
      userId,
      escalation.restriction_level,
      escalation.restriction_reason,
      escalation.restriction_type,
      escalation.banned_until,
      escalation.cooldown_until,
      escalation.requires_reliability_deposit,
      escalation.reliability_deposit_amount,
    ]
  );

  const event = {
    userId,
    role: effectiveRole,
    reservationId,
    reason,
    restrictionLevel: escalation.restriction_level,
    bannedUntil: escalation.banned_until,
    cooldownUntil: escalation.cooldown_until,
  };
  logger.security("Restriction violation recorded", event);
  void recordOperationalEvent({
    category: "security",
    severity: escalation.banned_until ? "warning" : "info",
    eventName: "restriction_violation",
    metadata: event,
  });
  if (escalation.banned_until || escalation.restriction_level >= 5) {
    void recordAlert({
      alertKey: `security:restriction:${effectiveRole}`,
      category: "security",
      severity: "warning",
      message: `Restriction escalation for ${effectiveRole}`,
      metadata: event,
    });
  }

  return escalation;
}

async function recordSuccessfulPickup({ client, userId, role }) {
  const user = await getUserForUpdate(client, userId);
  if (!user) return null;

  const currentLevel = asNumber(user.restriction_level);
  const nextStreak = asNumber(user.successful_pickups_count) + 1;
  const recoveredLevel =
    currentLevel > 0 && nextStreak >= RECOVERY_STREAK ? currentLevel - 1 : currentLevel;
  const remainingStreak = nextStreak >= RECOVERY_STREAK ? 0 : nextStreak;
  const depositAmount = calculateDepositForRole(role || user.role, recoveredLevel);

  await client.query(
    `
    UPDATE users
    SET successful_pickups_count = $2,
        total_successful_pickups = COALESCE(total_successful_pickups, 0) + 1,
        trust_score = LEAST(COALESCE(trust_score, 100) + 5, 100),
        restriction_level = $3,
        requires_reliability_deposit = $4,
        reliability_deposit_amount = $5,
        cooldown_until = CASE WHEN $3 < restriction_level THEN NULL ELSE cooldown_until END,
        restriction_reason = CASE WHEN $3 = 0 THEN NULL ELSE restriction_reason END
    WHERE id=$1
    `,
    [userId, remainingStreak, recoveredLevel, depositAmount > 0, depositAmount]
  );

  return { restrictionLevel: recoveredLevel, successfulPickupsCount: remainingStreak };
}

module.exports = {
  calculateDepositForRole,
  getReservationPolicy,
  recordSuccessfulPickup,
  recordViolation,
};
