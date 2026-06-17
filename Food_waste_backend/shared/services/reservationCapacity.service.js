const pool = require("../config/db");
const {
  reservationPolicy: defaultReservationPolicy,
} = require("../config/reservationPolicy");
const {
  getTrustEnforcementPolicy,
} = require("./trustEnforcement.service");
const { lifecycleSql } = require("./reservationLifecycle.service");

function activeReservationWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";

  return `
    (${lifecycleSql(alias)}) = 'active'
    AND COALESCE((${prefix}payment_context->>'stock_reserved')::boolean, true) = true
  `;
}

function normalizeRestrictionLevel(value) {
  const level = Number(value || 0);
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.floor(level);
}

function levelBucket(restrictionLevel) {
  if (restrictionLevel >= 3) return 3;
  if (restrictionLevel >= 2) return 2;
  if (restrictionLevel >= 1) return 1;
  return 0;
}

function maxActiveFor({ role, restrictionLevel, cooldownActive, policy }) {
  if (cooldownActive) return 0;

  const rolePolicy = role === "ngo" ? policy.ngo : policy.user;
  const bucket = levelBucket(restrictionLevel);
  if (bucket === 0) return rolePolicy.maxActiveReservations;

  return rolePolicy.restrictionLimits[bucket];
}

function bulkEnabledFor({ role, restrictionLevel, cooldownActive, depositRequired, policy }) {
  if (role !== "ngo") return false;
  if (cooldownActive) return false;
  if (depositRequired && policy.depositEnforcementDisableBulk) return false;

  const bucket = levelBucket(restrictionLevel);
  if (bucket === 0) return policy.ngo.bulkEnabled.normal;

  return policy.ngo.bulkEnabled[bucket];
}

async function countActiveReservations({ client = pool, userId }) {
  const result = await client.query(
    `
    SELECT COUNT(*)::int AS active_reservations
    FROM reservations r
    WHERE r.user_id=$1
    AND ${activeReservationWhere("r")}
    `,
    [userId]
  );

  return Number(result.rows[0]?.active_reservations || 0);
}

async function lockCapacitySubject({ client = pool, userId }) {
  await client.query(
    `
    SELECT id
    FROM users
    WHERE id=$1
    FOR UPDATE
    `,
    [userId]
  );
}

async function getReservationCapacity({
  client = pool,
  userId,
  role,
  foodCost = 0,
  trustPolicy,
  policy = defaultReservationPolicy,
} = {}) {
  const effectiveRole = role === "ngo" ? "ngo" : "user";
  const enforcementPolicy =
    trustPolicy ||
    (await getTrustEnforcementPolicy({
      client,
      userId,
      role: effectiveRole,
      foodCost,
    }));

  await lockCapacitySubject({ client, userId });
  const activeReservations = await countActiveReservations({ client, userId });
  const restrictionLevel = normalizeRestrictionLevel(
    enforcementPolicy.restrictionLevel
  );
  const cooldownActive = Boolean(enforcementPolicy.cooldownUntil);
  const depositRequired = Boolean(enforcementPolicy.requiresDeposit);
  const maxActiveReservations = maxActiveFor({
    role: effectiveRole,
    restrictionLevel,
    cooldownActive,
    policy,
  });
  const remainingCapacity = Math.max(maxActiveReservations - activeReservations, 0);
  const bulkReservationEnabled = bulkEnabledFor({
    role: effectiveRole,
    restrictionLevel,
    cooldownActive,
    depositRequired,
    policy,
  });
  const reservationBlocked =
    !enforcementPolicy.canReserve ||
    cooldownActive ||
    remainingCapacity <= 0 ||
    maxActiveReservations <= 0;

  return {
    activeReservations,
    maxActiveReservations,
    remainingCapacity,
    bulkReservationEnabled,
    depositRequired,
    reservationBlocked,
  };
}

function capacityMessage(reason, role = "user") {
  if (reason === "bulk_disabled") {
    return "Bulk reservations are temporarily disabled due to account reliability restrictions.";
  }

  if (reason === "deposit_bulk_disabled") {
    return "Reservations currently require a refundable reliability deposit. Reserve and complete listings one at a time until restrictions are lifted.";
  }

  if (reason === "capacity_exhausted") {
    return "You have reached your active reservation limit. Complete or close an existing reservation before creating another.";
  }

  if (reason === "capacity_exceeded") {
    return role === "ngo"
      ? "Requested reservations exceed your active reservation capacity. Reserve fewer listings or complete existing reservations first."
      : "Requested reservations exceed your active reservation capacity. Complete an existing reservation before creating another.";
  }

  return "Reservation capacity restricted.";
}

function assertReservationCapacity({ capacity, requestedReservationCount, role = "user" }) {
  const requested = Number(requestedReservationCount);
  if (!Number.isInteger(requested) || requested <= 0) {
    const error = new Error("Requested reservation count must be a positive integer");
    error.statusCode = 400;
    error.reason = "invalid_requested_reservation_count";
    error.capacity = capacity;
    throw error;
  }

  if (capacity.remainingCapacity <= 0) {
    const error = new Error(capacityMessage("capacity_exhausted", role));
    error.statusCode = 409;
    error.reason = "capacity_exhausted";
    error.capacity = {
      ...capacity,
      reservationBlocked: true,
    };
    throw error;
  }

  if (requested > capacity.remainingCapacity) {
    const error = new Error(capacityMessage("capacity_exceeded", role));
    error.statusCode = 409;
    error.reason = "capacity_exceeded";
    error.capacity = {
      ...capacity,
      reservationBlocked: true,
    };
    throw error;
  }

  if (!capacity.bulkReservationEnabled && requested > 1) {
    const reason = capacity.depositRequired
      ? "deposit_bulk_disabled"
      : "bulk_disabled";
    const error = new Error(capacityMessage(reason, role));
    error.statusCode = 409;
    error.reason = reason;
    error.capacity = {
      ...capacity,
      reservationBlocked: true,
    };
    throw error;
  }

  return capacity;
}

async function enforceReservationCapacity(options = {}) {
  const capacity =
    options.capacity || (await getReservationCapacity(options));
  assertReservationCapacity({
    capacity,
    requestedReservationCount: options.requestedReservationCount,
    role: options.role,
  });
  return capacity;
}

module.exports = {
  activeReservationWhere,
  assertReservationCapacity,
  countActiveReservations,
  enforceReservationCapacity,
  getReservationCapacity,
  lockCapacitySubject,
};
