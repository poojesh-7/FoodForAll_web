const DEFAULT_RESERVATION_POLICY_ENV = Object.freeze({
  USER_MAX_ACTIVE_RESERVATIONS: 5,
  USER_RL1_MAX_ACTIVE_RESERVATIONS: 3,
  USER_RL2_MAX_ACTIVE_RESERVATIONS: 2,
  USER_RL3_MAX_ACTIVE_RESERVATIONS: 1,
  NGO_MAX_ACTIVE_RESERVATIONS: 8,
  NGO_RL1_MAX_ACTIVE_RESERVATIONS: 5,
  NGO_RL2_MAX_ACTIVE_RESERVATIONS: 2,
  NGO_RL3_MAX_ACTIVE_RESERVATIONS: 1,
  NGO_RL1_BULK_ENABLED: true,
  NGO_RL2_BULK_ENABLED: false,
  NGO_RL3_BULK_ENABLED: false,
  DEPOSIT_ENFORCEMENT_DISABLE_BULK: true,
});

function parseNonNegativeInteger(name, fallback, env = process.env) {
  const raw = String(env[name] ?? fallback).trim();
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

function parseBooleanFlag(name, fallback, env = process.env) {
  const raw = String(env[name] ?? fallback).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;

  throw new Error(`${name} must be a boolean flag`);
}

function buildReservationPolicy(env = process.env) {
  return Object.freeze({
    user: Object.freeze({
      maxActiveReservations: parseNonNegativeInteger(
        "USER_MAX_ACTIVE_RESERVATIONS",
        DEFAULT_RESERVATION_POLICY_ENV.USER_MAX_ACTIVE_RESERVATIONS,
        env
      ),
      restrictionLimits: Object.freeze({
        1: parseNonNegativeInteger(
          "USER_RL1_MAX_ACTIVE_RESERVATIONS",
          DEFAULT_RESERVATION_POLICY_ENV.USER_RL1_MAX_ACTIVE_RESERVATIONS,
          env
        ),
        2: parseNonNegativeInteger(
          "USER_RL2_MAX_ACTIVE_RESERVATIONS",
          DEFAULT_RESERVATION_POLICY_ENV.USER_RL2_MAX_ACTIVE_RESERVATIONS,
          env
        ),
        3: parseNonNegativeInteger(
          "USER_RL3_MAX_ACTIVE_RESERVATIONS",
          DEFAULT_RESERVATION_POLICY_ENV.USER_RL3_MAX_ACTIVE_RESERVATIONS,
          env
        ),
      }),
    }),
    ngo: Object.freeze({
      maxActiveReservations: parseNonNegativeInteger(
        "NGO_MAX_ACTIVE_RESERVATIONS",
        DEFAULT_RESERVATION_POLICY_ENV.NGO_MAX_ACTIVE_RESERVATIONS,
        env
      ),
      restrictionLimits: Object.freeze({
        1: parseNonNegativeInteger(
          "NGO_RL1_MAX_ACTIVE_RESERVATIONS",
          DEFAULT_RESERVATION_POLICY_ENV.NGO_RL1_MAX_ACTIVE_RESERVATIONS,
          env
        ),
        2: parseNonNegativeInteger(
          "NGO_RL2_MAX_ACTIVE_RESERVATIONS",
          DEFAULT_RESERVATION_POLICY_ENV.NGO_RL2_MAX_ACTIVE_RESERVATIONS,
          env
        ),
        3: parseNonNegativeInteger(
          "NGO_RL3_MAX_ACTIVE_RESERVATIONS",
          DEFAULT_RESERVATION_POLICY_ENV.NGO_RL3_MAX_ACTIVE_RESERVATIONS,
          env
        ),
      }),
      bulkEnabled: Object.freeze({
        normal: true,
        1: parseBooleanFlag(
          "NGO_RL1_BULK_ENABLED",
          DEFAULT_RESERVATION_POLICY_ENV.NGO_RL1_BULK_ENABLED,
          env
        ),
        2: parseBooleanFlag(
          "NGO_RL2_BULK_ENABLED",
          DEFAULT_RESERVATION_POLICY_ENV.NGO_RL2_BULK_ENABLED,
          env
        ),
        3: parseBooleanFlag(
          "NGO_RL3_BULK_ENABLED",
          DEFAULT_RESERVATION_POLICY_ENV.NGO_RL3_BULK_ENABLED,
          env
        ),
      }),
    }),
    depositEnforcementDisableBulk: parseBooleanFlag(
      "DEPOSIT_ENFORCEMENT_DISABLE_BULK",
      DEFAULT_RESERVATION_POLICY_ENV.DEPOSIT_ENFORCEMENT_DISABLE_BULK,
      env
    ),
  });
}

module.exports = {
  DEFAULT_RESERVATION_POLICY_ENV,
  buildReservationPolicy,
  reservationPolicy: buildReservationPolicy(),
};
