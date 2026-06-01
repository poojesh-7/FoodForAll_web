const pool = require("../config/db");
const logger = require("../utils/logger");
const {
  incrementCounter,
  setGauge,
} = require("./metrics.service");
const {
  recordOperationalEvent,
} = require("./observability.service");

function numberFromEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value, max));
}

function intFromEnv(name, fallback, options = {}) {
  return Math.trunc(numberFromEnv(name, fallback, options));
}

function getAbuseGuardConfig() {
  return {
    trustLowScoreThreshold: numberFromEnv("TRUST_LOW_SCORE_THRESHOLD", 70, {
      min: 0,
      max: 100,
    }),
    trustHighScoreThreshold: numberFromEnv("TRUST_HIGH_SCORE_THRESHOLD", 95, {
      min: 0,
      max: 100,
    }),
    maxUnpaidHoldsLowTrust: intFromEnv("MAX_UNPAID_HOLDS_LOW_TRUST", 1, {
      min: 0,
      max: 20,
    }),
    maxUnpaidHoldsNormal: intFromEnv("MAX_UNPAID_HOLDS_NORMAL", 3, {
      min: 1,
      max: 50,
    }),
    maxUnpaidHoldsHighTrust: intFromEnv("MAX_UNPAID_HOLDS_HIGH_TRUST", 4, {
      min: 1,
      max: 100,
    }),
    abandonmentLookbackHours: intFromEnv("ABUSE_HOLD_LOOKBACK_HOURS", 24, {
      min: 1,
      max: 24 * 30,
    }),
    excessiveHoldPatternThreshold: intFromEnv("EXCESSIVE_HOLD_PATTERN_THRESHOLD", 5, {
      min: 1,
      max: 100,
    }),
    repeatedAbandonmentThreshold: intFromEnv("REPEATED_ABANDONMENT_THRESHOLD", 3, {
      min: 1,
      max: 100,
    }),
  };
}

function trustTierFromScore(score, config = getAbuseGuardConfig()) {
  const normalizedScore = Number(score);
  if (!Number.isFinite(normalizedScore)) return "normal";
  if (normalizedScore <= config.trustLowScoreThreshold) return "low";
  if (normalizedScore >= config.trustHighScoreThreshold) return "high";
  return "normal";
}

function holdLimitForTier(tier, config = getAbuseGuardConfig()) {
  if (tier === "low") return config.maxUnpaidHoldsLowTrust;
  if (tier === "high") return config.maxUnpaidHoldsHighTrust;
  return config.maxUnpaidHoldsNormal;
}

function withStatus(message, statusCode, reason) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.reason = reason;
  return error;
}

function recordAbuseGuardEvent(eventName, metadata = {}, severity = "warning") {
  incrementCounter("food_rescue_abuse_guard_events_total", {
    event: eventName,
    subject_type: metadata.subjectType || "user",
    result: metadata.result || "observed",
  });

  if (process.env.ABUSE_GUARD_RECORD_OPERATIONAL_EVENTS !== "false") {
    void recordOperationalEvent({
      category: "abuse",
      severity,
      eventName,
      metadata,
    });
  }
}

async function loadUserTrustTier(client, userId) {
  const result = await client.query(
    `
    SELECT trust_score, risk_category, projected_restriction_level
    FROM trust_scores
    WHERE subject_type='user'
    AND subject_id=$1
    `,
    [userId]
  );
  const row = result.rows[0] || {};
  const score = row.trust_score === undefined ? null : Number(row.trust_score);
  const tier = trustTierFromScore(score);

  return {
    score,
    tier,
    riskCategory: row.risk_category || "normal",
    projectedRestrictionLevel: Number(row.projected_restriction_level || 0),
  };
}

async function getReservationHoldCounters(client, userId, options = {}) {
  const lookbackHours = intFromEnv(
    "ABUSE_HOLD_LOOKBACK_HOURS",
    options.lookbackHours || getAbuseGuardConfig().abandonmentLookbackHours,
    { min: 1, max: 24 * 30 }
  );
  const result = await client.query(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE status='payment_pending'
        AND payment_status='pending'
        AND COALESCE(payment_expires_at, reserved_at + INTERVAL '10 minutes') > NOW()
      )::int AS active_unpaid_holds,
      COUNT(*) FILTER (
        WHERE (
          status IN ('abandoned_payment', 'cancelled_before_confirmation')
          OR payment_status IN ('abandoned', 'cancelled')
        )
        AND reserved_at >= NOW() - ($2::int * INTERVAL '1 hour')
      )::int AS abandoned_payment_holds,
      COUNT(*) FILTER (
        WHERE (
          status IN ('expired_payment', 'payment_failed')
          OR payment_status IN ('expired', 'failed')
          OR (
            status='payment_pending'
            AND payment_status='pending'
            AND COALESCE(payment_expires_at, reserved_at + INTERVAL '10 minutes') <= NOW()
          )
        )
        AND reserved_at >= NOW() - ($2::int * INTERVAL '1 hour')
      )::int AS expired_payment_holds,
      COUNT(*) FILTER (
        WHERE (
          status IN (
            'abandoned_payment',
            'cancelled_before_confirmation',
            'expired_payment',
            'payment_failed'
          )
          OR payment_status IN ('abandoned', 'cancelled', 'expired', 'failed')
        )
        AND reserved_at >= NOW() - ($2::int * INTERVAL '1 hour')
      )::int AS abandoned_reservation_count
    FROM reservations
    WHERE user_id=$1
    `,
    [userId, lookbackHours]
  );

  return {
    activeUnpaidHolds: Number(result.rows[0]?.active_unpaid_holds || 0),
    abandonedPaymentHolds: Number(result.rows[0]?.abandoned_payment_holds || 0),
    expiredPaymentHolds: Number(result.rows[0]?.expired_payment_holds || 0),
    abandonedReservationCount: Number(result.rows[0]?.abandoned_reservation_count || 0),
    lookbackHours,
  };
}

function publishHoldCounterMetrics(userId, tier, counters) {
  setGauge("food_rescue_active_unpaid_holds", { trust_tier: tier }, counters.activeUnpaidHolds);
  setGauge(
    "food_rescue_abandoned_payment_holds",
    { trust_tier: tier },
    counters.abandonedPaymentHolds
  );
  setGauge(
    "food_rescue_expired_payment_holds",
    { trust_tier: tier },
    counters.expiredPaymentHolds
  );
  setGauge(
    "food_rescue_abandoned_reservations",
    { trust_tier: tier },
    counters.abandonedReservationCount
  );
  logger.debug("Reservation abuse counters evaluated", { userId, tier, counters });
}

async function evaluateReservationSpamGuard(client, userId) {
  const config = getAbuseGuardConfig();
  const trust = await loadUserTrustTier(client, userId);
  const counters = await getReservationHoldCounters(client, userId, {
    lookbackHours: config.abandonmentLookbackHours,
  });
  const limit = holdLimitForTier(trust.tier, config);
  const metadata = {
    subjectType: "user",
    userId,
    trustTier: trust.tier,
    trustScore: trust.score,
    activeUnpaidHolds: counters.activeUnpaidHolds,
    abandonedPaymentHolds: counters.abandonedPaymentHolds,
    expiredPaymentHolds: counters.expiredPaymentHolds,
    abandonedReservationCount: counters.abandonedReservationCount,
    limit,
    lookbackHours: counters.lookbackHours,
  };

  publishHoldCounterMetrics(userId, trust.tier, counters);

  if (counters.activeUnpaidHolds >= limit) {
    recordAbuseGuardEvent(
      "reservation_spam_blocked",
      { ...metadata, result: "blocked", reason: "active_unpaid_hold_limit" },
      "warning"
    );
    throw withStatus(
      "Too many pending payments. Please finish or wait for existing payments to expire.",
      429,
      "reservation_spam_blocked"
    );
  }

  const holdPatternCount = counters.activeUnpaidHolds + counters.expiredPaymentHolds;
  if (holdPatternCount >= config.excessiveHoldPatternThreshold) {
    recordAbuseGuardEvent("excessive_hold_patterns", {
      ...metadata,
      result: "observed",
      holdPatternCount,
      threshold: config.excessiveHoldPatternThreshold,
    });
  }

  if (counters.abandonedReservationCount >= config.repeatedAbandonmentThreshold) {
    recordAbuseGuardEvent("repeated_abandonment", {
      ...metadata,
      result: "observed",
      threshold: config.repeatedAbandonmentThreshold,
    });
  }

  return {
    allowed: true,
    trust,
    counters,
    limit,
  };
}

function abuseAnalyticsLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 25;
  return Math.max(1, Math.min(Math.trunc(number), 100));
}

async function getAbuseAnalytics(options = {}) {
  const db = options.db || pool;
  const limit = abuseAnalyticsLimit(options.limit);
  const lookbackDays = Math.max(1, Math.min(Math.trunc(Number(options.sinceDays || 30)), 365));

  const [
    topAbandonedHoldUsers,
    trustGainDistribution,
    repeatedProviderPairings,
    suspiciousTrustGrowth,
  ] = await Promise.all([
    db.query(
      `
      SELECT r.user_id,
             COUNT(*) FILTER (
               WHERE r.status IN (
                 'abandoned_payment',
                 'cancelled_before_confirmation',
                 'expired_payment',
                 'payment_failed'
               )
               OR r.payment_status IN ('abandoned','cancelled','expired','failed')
             )::int AS abandoned_hold_count,
             COUNT(*) FILTER (
               WHERE r.status='payment_pending'
               AND r.payment_status='pending'
               AND COALESCE(r.payment_expires_at, r.reserved_at + INTERVAL '10 minutes') > NOW()
             )::int AS active_unpaid_holds,
             MAX(r.reserved_at) AS last_seen_at
      FROM reservations r
      WHERE r.reserved_at >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY r.user_id
      HAVING COUNT(*) FILTER (
        WHERE r.status IN (
          'abandoned_payment',
          'cancelled_before_confirmation',
          'expired_payment',
          'payment_failed'
        )
        OR r.payment_status IN ('abandoned','cancelled','expired','failed')
      ) > 0
      ORDER BY abandoned_hold_count DESC, active_unpaid_holds DESC, last_seen_at DESC
      LIMIT $2
      `,
      [lookbackDays, limit]
    ),
    db.query(
      `
      SELECT width_bucket(
               CASE
                 WHEN (te.event_payload->>'score_delta') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                 THEN GREATEST((te.event_payload->>'score_delta')::numeric, 0)
                 ELSE 0
               END,
               0,
               10,
               10
             )::int AS gain_bucket,
             COUNT(*)::int AS events,
             ROUND(AVG(
               CASE
                 WHEN (te.event_payload->>'score_delta') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                 THEN GREATEST((te.event_payload->>'score_delta')::numeric, 0)
                 ELSE 0
               END
             ), 2) AS average_raw_gain
      FROM trust_events te
      WHERE te.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND te.subject_type IN ('user','ngo','volunteer')
      GROUP BY gain_bucket
      ORDER BY gain_bucket ASC
      `,
      [lookbackDays]
    ),
    db.query(
      `
      SELECT te.subject_type, te.subject_id,
             te.event_payload->'metadata'->>'provider_id' AS provider_id,
             COUNT(*)::int AS successful_pairings,
             MIN(te.created_at) AS first_seen_at,
             MAX(te.created_at) AS last_seen_at
      FROM trust_events te
      WHERE te.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND te.event_type IN (
        'user_pickup_completed',
        'ngo_delivery_completed',
        'volunteer_delivery_completed'
      )
      AND te.event_payload->'metadata'->>'provider_id' IS NOT NULL
      GROUP BY te.subject_type, te.subject_id, provider_id
      HAVING COUNT(*) > 1
      ORDER BY successful_pairings DESC, last_seen_at DESC
      LIMIT $2
      `,
      [lookbackDays, limit]
    ),
    db.query(
      `
      SELECT te.subject_type, te.subject_id,
             date_trunc('day', te.created_at)::date AS bucket,
             SUM(
               CASE
                 WHEN (te.event_payload->>'score_delta') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                 THEN GREATEST((te.event_payload->>'score_delta')::numeric, 0)
                 ELSE 0
               END
             ) AS raw_positive_gain,
             COUNT(*) FILTER (
               WHERE te.event_type IN (
                 'user_pickup_completed',
                 'ngo_delivery_completed',
                 'volunteer_delivery_completed'
               )
             )::int AS success_events,
             COUNT(DISTINCT te.event_payload->'metadata'->>'provider_id') AS distinct_providers,
             MAX(te.created_at) AS last_seen_at
      FROM trust_events te
      WHERE te.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND te.subject_type IN ('user','ngo','volunteer')
      GROUP BY te.subject_type, te.subject_id, bucket
      HAVING SUM(
        CASE
          WHEN (te.event_payload->>'score_delta') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN GREATEST((te.event_payload->>'score_delta')::numeric, 0)
          ELSE 0
        END
      ) >= $3::numeric
      OR (
        COUNT(*) FILTER (
          WHERE te.event_type IN (
            'user_pickup_completed',
            'ngo_delivery_completed',
            'volunteer_delivery_completed'
          )
        ) >= 3
        AND COUNT(DISTINCT te.event_payload->'metadata'->>'provider_id') <= 1
      )
      ORDER BY raw_positive_gain DESC, success_events DESC, last_seen_at DESC
      LIMIT $2
      `,
      [lookbackDays, limit, numberFromEnv("TRUST_RAPID_GROWTH_DIAGNOSTIC_THRESHOLD", 8)]
    ),
  ]);

  return {
    filters: { limit, sinceDays: lookbackDays },
    topAbandonedHoldUsers: topAbandonedHoldUsers.rows,
    trustGainDistribution: trustGainDistribution.rows,
    repeatedProviderPairings: repeatedProviderPairings.rows,
    suspiciousTrustGrowth: suspiciousTrustGrowth.rows,
  };
}

module.exports = {
  evaluateReservationSpamGuard,
  getAbuseAnalytics,
  getAbuseGuardConfig,
  getReservationHoldCounters,
  holdLimitForTier,
  recordAbuseGuardEvent,
  trustTierFromScore,
};
