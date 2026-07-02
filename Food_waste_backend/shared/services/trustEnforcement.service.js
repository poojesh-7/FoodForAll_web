const pool = require("../config/db");
const logger = require("../utils/logger");
const {
  incrementCounter,
} = require("./metrics.service");
const {
  recordOperationalEvent,
} = require("./observability.service");
const {
  appendTrustEventIfMissing,
  isUuid,
} = require("./trustEvent.service");
const {
  buildProviderReportTrustEvents,
  buildReservationTrustEvents,
  emitBuiltEvents,
} = require("./trustLifecycleEvent.service");

const SUBJECT_TYPE_BY_ROLE = {
  user: "user",
  ngo: "ngo",
  volunteer: "volunteer",
  provider: "provider",
};

const RESERVATION_BLOCK_LEVEL = 5;
const VOLUNTEER_TASK_BLOCK_LEVEL = 5;
const PROVIDER_LISTING_BLOCK_LEVEL = 5;
const DEPOSIT_LEVEL = 2;

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function activeUntil(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date > now ? date : null;
}

function subjectTypeForRole(role) {
  return SUBJECT_TYPE_BY_ROLE[role] || "user";
}

function defaultTrustScore(subjectType, subjectId) {
  return {
    subject_type: subjectType,
    subject_id: subjectId,
    trust_score: 100,
    penalty_level: 0,
    restriction_level: 0,
    cooldown_until: null,
    deposit_multiplier: 1,
    risk_category: "normal",
    recovery_progress: 100,
    recovery_state: {},
    risk_state: {},
    score_breakdown: {},
    projected_actions: {},
    updated_at: null,
  };
}

function normalizeTrustScore(row, subjectType, subjectId) {
  if (!row) return defaultTrustScore(subjectType, subjectId);

  return {
    subject_type: row.subject_type || subjectType,
    subject_id: row.subject_id || subjectId,
    trust_score: asNumber(row.trust_score, 100),
    penalty_level: asNumber(row.penalty_level, 0),
    restriction_level: asNumber(
      row.projected_restriction_level ?? row.restriction_level,
      0
    ),
    cooldown_until: row.projected_cooldown_until ?? row.cooldown_until ?? null,
    deposit_multiplier: asNumber(
      row.projected_deposit_multiplier ?? row.deposit_multiplier,
      1
    ),
    risk_category: row.risk_category || "normal",
    recovery_progress: asNumber(row.recovery_progress, 100),
    recovery_state: row.recovery_state || {},
    risk_state: row.risk_state || {},
    score_breakdown: row.score_breakdown || {},
    projected_actions: row.projected_actions || {},
    updated_at: row.updated_at || null,
  };
}

async function loadTrustProjection({ client = pool, subjectType, subjectId }) {
  const result = await client.query(
    `
    SELECT subject_type, subject_id, trust_score, penalty_level,
           restriction_level, cooldown_until, deposit_multiplier,
           projected_restriction_level, projected_cooldown_until,
           projected_deposit_multiplier, risk_category, recovery_progress,
           recovery_state, risk_state, score_breakdown, projected_actions, updated_at
    FROM trust_scores
    WHERE subject_type=$1
    AND subject_id=$2
    `,
    [subjectType, subjectId]
  );

  return normalizeTrustScore(result.rows[0], subjectType, subjectId);
}

function baseDepositAmount(role, foodCost = 0) {
  if (role === "ngo") {
    return roundMoney(process.env.TRUST_NGO_BASE_DEPOSIT_AMOUNT || 100);
  }

  if (role === "user") {
    const baseRate = asNumber(process.env.TRUST_USER_DEPOSIT_BASE_RATE, 0.2);
    const minimum = asNumber(process.env.TRUST_USER_MIN_DEPOSIT_AMOUNT, 20);
    return roundMoney(Math.max(minimum, asNumber(foodCost, 0) * baseRate));
  }

  return 0;
}

function calculateDepositAmount({
  role,
  foodCost = 0,
  restrictionLevel = 0,
  depositMultiplier = 1,
}) {
  if (!["user", "ngo"].includes(role)) return 0;

  const multiplier = Math.max(1, asNumber(depositMultiplier, 1));
  if (restrictionLevel < DEPOSIT_LEVEL && multiplier <= 1) return 0;

  const base = baseDepositAmount(role, foodCost);
  if (base <= 0) return 0;

  return roundMoney(base * multiplier);
}

function restrictionReason({ action, restrictionLevel, cooldownUntil }) {
  if (cooldownUntil) {
    return `Trust cooldown active until ${cooldownUntil.toISOString()}`;
  }

  if (restrictionLevel >= RESERVATION_BLOCK_LEVEL) {
    return "Manual trust review required before this action";
  }

  if (action === "take_task" && restrictionLevel >= VOLUNTEER_TASK_BLOCK_LEVEL) {
    return "Volunteer task access is temporarily restricted";
  }

  return null;
}

function buildTrustEnforcementPolicy({
  role,
  projection,
  foodCost = 0,
  now = new Date(),
}) {
  const restrictionLevel = asNumber(projection.restriction_level, 0);
  const penaltyLevel = asNumber(projection.penalty_level, 0);
  const depositMultiplier = Math.max(1, asNumber(projection.deposit_multiplier, 1));
  const cooldownUntil = activeUntil(projection.cooldown_until, now);
  const depositAmount = calculateDepositAmount({
    role,
    foodCost,
    restrictionLevel,
    depositMultiplier,
  });

  const canReserve =
    !cooldownUntil && restrictionLevel < RESERVATION_BLOCK_LEVEL;
  const canTakeTask =
    !cooldownUntil && restrictionLevel < VOLUNTEER_TASK_BLOCK_LEVEL;
  const canList =
    !cooldownUntil && restrictionLevel < PROVIDER_LISTING_BLOCK_LEVEL;

  return {
    canReserve,
    canTakeTask,
    canList,
    requiresDeposit: depositAmount > 0,
    depositAmount,
    depositMultiplier,
    restrictionLevel,
    penaltyLevel,
    cooldownUntil,
    bannedUntil: null,
    trustScore: asNumber(projection.trust_score, 100),
    riskCategory: projection.risk_category || "normal",
    recoveryProgress: asNumber(projection.recovery_progress, 100),
    recoveryState: projection.recovery_state || {},
    riskState: projection.risk_state || {},
    scoreBreakdown: projection.score_breakdown || {},
    restrictionTriggerSource:
      projection.risk_state?.restriction_trigger_source ||
      projection.projected_actions?.restriction_trigger_source ||
      null,
    recoveryRequirements:
      projection.risk_state?.recovery_requirements ||
      projection.recovery_state?.recovery_requirements ||
      projection.projected_actions?.recovery_requirements ||
      {},
    blockedActorRecoveryStatus:
      projection.risk_state?.blocked_actor_recovery_status ||
      projection.recovery_state?.blocked_actor_recovery_status ||
      projection.projected_actions?.blocked_actor_recovery_status ||
      {},
    projectedActions: {
      ...(projection.projected_actions || {}),
      enforcement_active: true,
    },
    restrictionReason:
      restrictionReason({ action: "reserve", restrictionLevel, cooldownUntil }) ||
      restrictionReason({ action: "take_task", restrictionLevel, cooldownUntil }) ||
      restrictionReason({ action: "list", restrictionLevel, cooldownUntil }),
    enforcementActive: true,
    source: "trust_scores",
    updatedAt: projection.updated_at || null,
  };
}

async function getTrustEnforcementPolicy({
  client = pool,
  userId,
  role,
  foodCost = 0,
  now = new Date(),
}) {
  const subjectType = subjectTypeForRole(role);
  const projection = await loadTrustProjection({
    client,
    subjectType,
    subjectId: userId,
  });
  const policy = buildTrustEnforcementPolicy({
    role,
    projection,
    foodCost,
    now,
  });

  incrementCounter("food_rescue_trust_enforcement_evaluations_total", {
    subject_type: subjectType,
    restriction_level: String(policy.restrictionLevel),
    result:
      policy.canReserve || policy.canTakeTask || policy.canList
        ? "allowed"
        : "restricted",
  });

  return policy;
}

function assertTrustActionAllowed(policy, action) {
  const allowedByAction = {
    reserve: policy.canReserve,
    take_task: policy.canTakeTask,
    list: policy.canList,
  };

  if (allowedByAction[action]) return policy;

  const error = new Error(
    policy.restrictionReason || "Trust enforcement restricted this action"
  );
  error.statusCode = 403;
  error.reason = "trust_enforcement_restricted";
  error.policy = policy;
  throw error;
}

async function loadReservationTrustRow(client, reservationId) {
  const result = await client.query(
    `
    SELECT r.id, r.user_id, r.listing_id, r.pickup_type, r.status, r.task_status,
           r.assigned_volunteer_id, r.completed_at, r.picked_up_at,
           r.payment_status, r.payment_expires_at, r.payment_context, r.reserved_at,
           f.provider_id, f.is_free, f.price,
           p.id AS payment_id,
           p.order_id AS payment_order_id,
           p.payment_session_id,
           p.food_amount,
           p.total_amount,
           p.status AS payment_row_status,
           p.refund_status,
           poa.order_id AS payment_attempt_order_id,
           poa.payment_session_id AS payment_attempt_session_id,
           poa.status AS payment_attempt_status
    FROM reservations r
    JOIN food_listings f ON f.id=r.listing_id
    LEFT JOIN LATERAL (
      SELECT id, order_id, payment_session_id, status, refund_status, food_amount, total_amount
      FROM payments
      WHERE reservation_id=r.id
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT order_id, payment_session_id, status
      FROM payment_order_attempts
      WHERE r.id = ANY(reservation_ids)
      OR order_id = r.payment_context->>'recovered_order_id'
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
    ) poa ON true
    WHERE r.id=$1
    `,
    [reservationId]
  );

  return result.rows[0] || null;
}

async function recordReservationLifecycleTrustEvents({
  client = pool,
  reservationId,
  appendTrustEvent,
  enqueue = false,
  recordOperationalEvent: shouldRecordOperationalEvent = true,
} = {}) {
  const row = await loadReservationTrustRow(client, reservationId);
  if (!row) return [];

  const events = buildReservationTrustEvents(row);
  const results = await emitBuiltEvents(events, {
    db: client,
    appendTrustEvent,
    enqueue,
  });

  if (results.length && shouldRecordOperationalEvent !== false) {
    void recordOperationalEvent({
      category: "trust",
      severity: "info",
      eventName: "trust_enforcement_lifecycle_events_recorded",
      metadata: {
        reservationId,
        eventTypes: results.map((result) => result.eventType),
      },
    });
  }

  return results;
}

async function recordProviderReportValidated({
  client = pool,
  report,
  appendTrustEvent,
  enqueue = false,
} = {}) {
  const events = buildProviderReportTrustEvents(report);
  return emitBuiltEvents(events, {
    db: client,
    appendTrustEvent,
    enqueue,
  });
}

async function recordVerifiedGoodBehavior({
  client = pool,
  subjectType,
  subjectId,
  sourceType,
  sourceId,
  reservationId = null,
  paymentId = null,
  metadata = {},
  appendTrustEvent = appendTrustEventIfMissing,
  enqueue = false,
} = {}) {
  if (!isUuid(subjectId)) {
    logger.warn("Verified good behavior trust event skipped for non-UUID subject", {
      subjectType,
      subjectId,
      sourceType,
      sourceId,
    });
    return { inserted: false, event: null };
  }

  return appendTrustEvent(
    {
      eventKey: `trust:${subjectType}:${subjectId}:verified_good_behavior:${sourceType}:${sourceId}`,
      subjectType,
      subjectId,
      sourceType,
      sourceId: String(sourceId),
      reservationId,
      paymentId,
      eventType: "verified_good_behavior",
      eventPayload: {
        score_delta: 3,
        completion_delta: 1,
        metadata: {
          verified_good_behavior: true,
          ...metadata,
        },
      },
    },
    {
      db: client,
      enqueue,
    }
  );
}

module.exports = {
  DEPOSIT_LEVEL,
  PROVIDER_LISTING_BLOCK_LEVEL,
  RESERVATION_BLOCK_LEVEL,
  VOLUNTEER_TASK_BLOCK_LEVEL,
  assertTrustActionAllowed,
  baseDepositAmount,
  buildTrustEnforcementPolicy,
  calculateDepositAmount,
  getTrustEnforcementPolicy,
  loadTrustProjection,
  recordProviderReportValidated,
  recordReservationLifecycleTrustEvents,
  recordVerifiedGoodBehavior,
  subjectTypeForRole,
};
