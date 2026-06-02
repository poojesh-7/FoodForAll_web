const crypto = require("crypto");
const pool = require("../config/db");
const {
  SUBJECT_TYPES,
  isUuid,
} = require("./trustEvent.service");
const {
  buildTrustEffect,
  buildTrustProjectionFromEvents,
} = require("./trustProjection.service");
const {
  getMetricsSnapshot,
  incrementCounter,
  setGauge,
} = require("./metrics.service");

const RISK_CATEGORIES = new Set([
  "normal",
  "watch",
  "elevated",
  "high",
  "severe",
  "critical",
]);
const COOLDOWN_FILTERS = new Set(["any", "active", "recommended", "none"]);
const EVENT_TYPE_PATTERN = /^[a-z0-9_:-]{1,120}$/i;
const PROJECTION_COMPARE_FIELDS = [
  "trust_score",
  "penalty_level",
  "deposit_multiplier",
  "cooldown_until",
  "restriction_level",
  "failure_count",
  "cancellation_count",
  "completion_count",
  "timeout_count",
  "fulfillment_count",
  "refund_count",
  "projected_restriction_level",
  "projected_cooldown_until",
  "projected_deposit_multiplier",
  "recovery_progress",
  "risk_category",
  "success_streak",
  "failure_streak",
  "last_success_at",
  "last_failure_at",
  "last_decay_at",
  "last_event_at",
];

function invalidFilter(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function compactText(value, maxLength = 120) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

function normalizeTrustFilters(input = {}) {
  const actorType = compactText(
    input.actorType || input.actor_type || input.subjectType || input.subject_type,
    40
  );
  const eventType = compactText(input.eventType || input.event_type, 120);
  const riskState = compactText(input.riskState || input.risk_state || input.riskCategory, 40);
  const cooldownProjection = compactText(
    input.cooldownProjection || input.cooldown_projection || input.cooldown,
    40
  );
  const rawRestriction =
    input.restrictionProjection ??
    input.restriction_projection ??
    input.restrictionLevel ??
    input.projectedRestrictionLevel;
  const restrictionProjection =
    rawRestriction === undefined || rawRestriction === null || rawRestriction === ""
      ? null
      : boundedInt(rawRestriction, null, 0, 5);

  if (actorType && !SUBJECT_TYPES.has(actorType)) {
    throw invalidFilter("Invalid trust actor type filter");
  }
  if (eventType && !EVENT_TYPE_PATTERN.test(eventType)) {
    throw invalidFilter("Invalid trust event type filter");
  }
  if (riskState && !RISK_CATEGORIES.has(riskState)) {
    throw invalidFilter("Invalid trust risk state filter");
  }
  if (cooldownProjection && !COOLDOWN_FILTERS.has(cooldownProjection)) {
    throw invalidFilter("Invalid trust cooldown projection filter");
  }

  return {
    actorType: actorType || null,
    eventType: eventType || null,
    riskState: riskState || null,
    restrictionProjection,
    cooldownProjection: cooldownProjection || "any",
    sinceDays: boundedInt(input.sinceDays || input.since_days, 30, 1, 365),
    limit: boundedInt(input.limit, 50, 1, 200),
  };
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function scoreWhere(filters, params, alias = "ts") {
  const where = ["1=1"];

  if (filters.actorType) {
    where.push(`${alias}.subject_type=${addParam(params, filters.actorType)}`);
  }
  if (filters.riskState) {
    where.push(`${alias}.risk_category=${addParam(params, filters.riskState)}`);
  }
  if (filters.restrictionProjection !== null) {
    where.push(`${alias}.projected_restriction_level=${addParam(params, filters.restrictionProjection)}`);
  }
  if (filters.cooldownProjection === "active" || filters.cooldownProjection === "recommended") {
    where.push(`${alias}.projected_cooldown_until IS NOT NULL`);
  }
  if (filters.cooldownProjection === "none") {
    where.push(`${alias}.projected_cooldown_until IS NULL`);
  }
  if (filters.eventType) {
    const eventTypeParam = addParam(params, filters.eventType);
    const sinceParam = addParam(params, filters.sinceDays);
    where.push(`
      EXISTS (
        SELECT 1
        FROM trust_events te_filter
        WHERE te_filter.subject_type=${alias}.subject_type
        AND te_filter.subject_id=${alias}.subject_id
        AND te_filter.event_type=${eventTypeParam}
        AND te_filter.created_at >= NOW() - (${sinceParam}::int * INTERVAL '1 day')
      )
    `);
  }

  return where.join(" AND ");
}

function eventWhere(filters, params, alias = "te") {
  const where = [
    `${alias}.created_at >= NOW() - (${addParam(params, filters.sinceDays)}::int * INTERVAL '1 day')`,
  ];

  if (filters.actorType) {
    where.push(`${alias}.subject_type=${addParam(params, filters.actorType)}`);
  }
  if (filters.eventType) {
    where.push(`${alias}.event_type=${addParam(params, filters.eventType)}`);
  }

  return where.join(" AND ");
}

function dateIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stableNormalize(value) {
  if (value instanceof Date) return dateIso(value);
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableNormalize(value[key]);
      return acc;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function eventSort(left, right) {
  const leftTime = new Date(left.created_at || 0).getTime();
  const rightTime = new Date(right.created_at || 0).getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function trustReplayChecksum(events) {
  const normalized = [...events].sort(eventSort).map((event) => {
    const effect = buildTrustEffect(event);
    return {
      id: event.id,
      eventKey: event.event_key,
      eventType: event.event_type,
      subjectType: event.subject_type,
      subjectId: event.subject_id,
      sourceType: event.source_type,
      sourceId: event.source_id,
      createdAt: dateIso(event.created_at),
      sourceLineage: event.event_payload?.metadata?.source_lineage || null,
      effect: {
        scoreDelta: effect.scoreDelta,
        penaltyDelta: effect.penaltyDelta,
        failureDelta: effect.failureDelta,
        cancellationDelta: effect.cancellationDelta,
        completionDelta: effect.completionDelta,
        timeoutDelta: effect.timeoutDelta,
        fulfillmentDelta: effect.fulfillmentDelta,
        refundDelta: effect.refundDelta,
        depositMultiplierDelta: effect.depositMultiplierDelta,
        restrictionLevelDelta: effect.restrictionLevelDelta,
        explicitRestrictionLevel: effect.explicitRestrictionLevel,
        cooldownUntil: dateIso(effect.cooldownUntil),
        analyticsOnly: effect.analyticsOnly,
      },
    };
  });

  return hashValue(normalized);
}

function projectionChecksum(projection) {
  if (!projection) return null;
  return hashValue(
    PROJECTION_COMPARE_FIELDS.reduce((acc, field) => {
      acc[field] = projection[field] ?? null;
      return acc;
    }, {})
  );
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function comparableValue(value) {
  const iso = dateIso(value);
  if (
    iso &&
    (value instanceof Date ||
      String(value).includes("T") ||
      /^\d{4}-\d{2}-\d{2}/.test(String(value)))
  ) {
    return iso;
  }
  const number = numericOrNull(value);
  if (number !== null) return number;
  return value ?? null;
}

function compareProjectionSnapshot(storedProjection, replayProjection) {
  if (!storedProjection && replayProjection) {
    return [{ field: "projection", stored: null, replay: "present" }];
  }

  const mismatches = [];
  for (const field of PROJECTION_COMPARE_FIELDS) {
    const stored = comparableValue(storedProjection?.[field]);
    const replay = comparableValue(replayProjection?.[field]);
    const bothNumeric = typeof stored === "number" && typeof replay === "number";
    const equal = bothNumeric ? Math.abs(stored - replay) < 0.000001 : stored === replay;
    if (!equal) {
      mismatches.push({ field, stored, replay });
    }
  }
  return mismatches;
}

function buildReplayLineage(events) {
  const sorted = [...events].sort(eventSort);
  const eventTypes = new Map();
  const sourceLineage = new Map();

  for (const event of sorted) {
    eventTypes.set(event.event_type, (eventTypes.get(event.event_type) || 0) + 1);
    const lineage = event.event_payload?.metadata?.source_lineage || "unknown";
    sourceLineage.set(lineage, (sourceLineage.get(lineage) || 0) + 1);
  }

  return {
    eventCount: sorted.length,
    firstEventAt: dateIso(sorted[0]?.created_at),
    lastEventAt: dateIso(sorted[sorted.length - 1]?.created_at),
    replayChecksum: trustReplayChecksum(sorted),
    eventTypes: Array.from(eventTypes.entries()).map(([eventType, count]) => ({
      eventType,
      count,
    })),
    sourceLineage: Array.from(sourceLineage.entries()).map(([lineage, count]) => ({
      lineage,
      count,
    })),
  };
}

function buildReplayDiagnostics({ events, storedProjection, subjectType, subjectId }) {
  const replayProjection = buildTrustProjectionFromEvents(events, subjectType, subjectId);
  const mismatches = compareProjectionSnapshot(storedProjection, replayProjection);
  const lineage = buildReplayLineage(events);
  const storedChecksum = projectionChecksum(storedProjection);
  const replayProjectionChecksum = projectionChecksum(replayProjection);

  return {
    consistent: mismatches.length === 0,
    mismatchCount: mismatches.length,
    mismatches,
    replayChecksum: lineage.replayChecksum,
    storedProjectionChecksum: storedChecksum,
    replayProjectionChecksum,
    checksumMatch: storedChecksum === replayProjectionChecksum,
    lineage,
    replayProjection,
  };
}

function previewFromScore(score) {
  const riskState = score?.risk_state || {};
  const recoveryState = score?.recovery_state || {};
  return {
    restriction: {
      level: Number(score?.projected_restriction_level ?? score?.restriction_level ?? 0),
      label: score?.risk_category || "normal",
      triggerSource: riskState.restriction_trigger_source || null,
      triggerSources: riskState.restriction_trigger_sources || [],
      enforcementActive: false,
    },
    cooldown: {
      recommended: Boolean(score?.projected_cooldown_until),
      until: score?.projected_cooldown_until || null,
    },
    deposit: {
      multiplier: Number(score?.projected_deposit_multiplier ?? score?.deposit_multiplier ?? 1),
    },
    recovery: {
      requirements:
        riskState.recovery_requirements ||
        recoveryState.recovery_requirements ||
        {},
      blockedActorStatus:
        riskState.blocked_actor_recovery_status ||
        recoveryState.blocked_actor_recovery_status ||
        {},
    },
  };
}

async function getTrustObservabilitySummary(options = {}) {
  const db = options.db || pool;
  const filters = normalizeTrustFilters(options);
  const scoreParams = [];
  const eventParams = [];
  const scoreFilter = scoreWhere(filters, scoreParams);
  const eventFilter = eventWhere(filters, eventParams);

  const [aggregate, byActorType, byRiskState, eventStatus, eventTypes, anomalies] =
    await Promise.all([
      db.query(
        `
        SELECT
          COUNT(*)::int AS actors,
          COALESCE(ROUND(AVG(trust_score), 2), 100)::numeric AS average_trust_score,
          COALESCE(MIN(trust_score), 100)::numeric AS minimum_trust_score,
          COUNT(*) FILTER (WHERE projected_restriction_level > 0)::int AS restriction_previews,
          COUNT(*) FILTER (WHERE projected_cooldown_until IS NOT NULL)::int AS cooldown_previews,
          COUNT(*) FILTER (WHERE projected_deposit_multiplier > 1)::int AS deposit_previews,
          COUNT(*) FILTER (WHERE risk_category IN ('high','severe','critical'))::int AS high_risk_actors
        FROM trust_scores ts
        WHERE ${scoreFilter}
        `,
        scoreParams
      ),
      db.query(
        `
        SELECT subject_type, COUNT(*)::int AS actors,
               COALESCE(ROUND(AVG(trust_score), 2), 100)::numeric AS average_trust_score,
               MAX(projected_restriction_level)::int AS max_projected_restriction_level
        FROM trust_scores ts
        WHERE ${scoreFilter}
        GROUP BY subject_type
        ORDER BY actors DESC, subject_type ASC
        `,
        scoreParams
      ),
      db.query(
        `
        SELECT risk_category, COUNT(*)::int AS actors
        FROM trust_scores ts
        WHERE ${scoreFilter}
        GROUP BY risk_category
        ORDER BY actors DESC, risk_category ASC
        `,
        scoreParams
      ),
      db.query(
        `
        SELECT processing_status, COUNT(*)::int AS events,
               MIN(created_at) AS oldest_event_at,
               MAX(created_at) AS newest_event_at
        FROM trust_events te
        WHERE ${eventFilter}
        GROUP BY processing_status
        ORDER BY events DESC, processing_status ASC
        `,
        eventParams
      ),
      db.query(
        `
        SELECT event_type, subject_type, COUNT(*)::int AS events,
               MAX(created_at) AS last_seen_at
        FROM trust_events te
        WHERE ${eventFilter}
        GROUP BY event_type, subject_type
        ORDER BY events DESC, last_seen_at DESC
        LIMIT 25
        `,
        eventParams
      ),
      getTrustAnomalySummary({ db, ...filters }),
    ]);

  return {
    filters,
    aggregate: aggregate.rows[0] || {},
    byActorType: byActorType.rows,
    byRiskState: byRiskState.rows,
    eventStatus: eventStatus.rows,
    eventTypes: eventTypes.rows,
    anomalies,
  };
}

async function getRecentTrustEvents(options = {}) {
  const db = options.db || pool;
  const filters = normalizeTrustFilters(options);
  const params = [];
  const where = eventWhere(filters, params);
  const limitParam = addParam(params, filters.limit);

  const result = await db.query(
    `
    SELECT te.id, te.event_key, te.subject_type, te.subject_id, te.source_type,
           te.source_id, te.reservation_id, te.payment_id, te.event_type,
           te.event_payload, te.processing_status, te.attempt_count,
           te.processed_at, te.last_error, te.created_at,
           ts.trust_score, ts.risk_category, ts.projected_restriction_level,
           ts.projected_cooldown_until, ts.projected_deposit_multiplier
    FROM trust_events te
    LEFT JOIN trust_scores ts
      ON ts.subject_type=te.subject_type
      AND ts.subject_id=te.subject_id
    WHERE ${where}
    ORDER BY te.created_at DESC, te.id DESC
    LIMIT ${limitParam}
    `,
    params
  );

  return { filters, events: result.rows };
}

async function loadSubjectProjection(db, subjectType, subjectId) {
  const score = await db.query(
    `
    SELECT *
    FROM trust_scores
    WHERE subject_type=$1 AND subject_id=$2
    `,
    [subjectType, subjectId]
  );
  const events = await db.query(
    `
    SELECT *
    FROM trust_events
    WHERE subject_type=$1
    AND subject_id=$2
    AND processing_status='processed'
    ORDER BY created_at ASC, id ASC
    `,
    [subjectType, subjectId]
  );

  return {
    score: score.rows[0] || null,
    events: events.rows,
  };
}

async function getTrustProjectionBreakdown(options = {}) {
  const db = options.db || pool;
  const subjectType = options.subjectType || options.subject_type;
  const subjectId = options.subjectId || options.subject_id;

  if (!SUBJECT_TYPES.has(subjectType) || !isUuid(subjectId)) {
    throw invalidFilter("Invalid trust subject");
  }

  const { score, events } = await loadSubjectProjection(db, subjectType, subjectId);
  const diagnostics = buildReplayDiagnostics({
    events,
    storedProjection: score,
    subjectType,
    subjectId,
  });

  if (!diagnostics.consistent) {
    incrementCounter("food_rescue_trust_replay_checksum_mismatches_total", {
      subject_type: subjectType,
    });
  }
  incrementCounter("food_rescue_trust_replay_diagnostics_total", {
    subject_type: subjectType,
    consistent: diagnostics.consistent ? "true" : "false",
  });

  return {
    subject: { subjectType, subjectId },
    projection: score,
    preview: previewFromScore(score),
    scoreBreakdown: score?.score_breakdown || {},
    projectedActions: score?.projected_actions || {},
    recoveryState: score?.recovery_state || {},
    decayState: score?.decay_state || {},
    riskState: score?.risk_state || {},
    replayLineage: diagnostics.lineage,
    diagnostics: {
      consistent: diagnostics.consistent,
      mismatchCount: diagnostics.mismatchCount,
      mismatches: diagnostics.mismatches,
      replayChecksum: diagnostics.replayChecksum,
      storedProjectionChecksum: diagnostics.storedProjectionChecksum,
      replayProjectionChecksum: diagnostics.replayProjectionChecksum,
      checksumMatch: diagnostics.checksumMatch,
    },
  };
}

async function getTrustAnalytics(options = {}) {
  const db = options.db || pool;
  const filters = normalizeTrustFilters(options);
  const scoreParams = [];
  const scoreFilter = scoreWhere(filters, scoreParams);
  const eventParams = [];
  const eventFilter = eventWhere(filters, eventParams);
  const limit = filters.limit;

  const [
    highestRiskActors,
    rapidlyDegradingActors,
    recoveryStreaks,
    paymentTimeoutPatterns,
    cancellationPatterns,
    providerOperationalHealth,
    volunteerDeliveryReliability,
  ] = await Promise.all([
    db.query(
      `
      SELECT subject_type, subject_id, trust_score, penalty_level, risk_category,
             projected_restriction_level, projected_cooldown_until,
             projected_deposit_multiplier, failure_streak, success_streak,
             last_failure_at, last_success_at, recovery_state, risk_state, updated_at
      FROM trust_scores ts
      WHERE ${scoreFilter}
      ORDER BY projected_restriction_level DESC, penalty_level DESC,
               trust_score ASC, failure_streak DESC, updated_at DESC
      LIMIT $${scoreParams.length + 1}
      `,
      [...scoreParams, limit]
    ),
    db.query(
      `
      SELECT te.subject_type, te.subject_id,
             SUM(
               CASE
                 WHEN te.event_type='provider_listing_expired'
                   OR LOWER(COALESCE(te.event_payload->>'analytics_only', 'false')) = 'true'
                 THEN 0
                 WHEN (te.event_payload->>'score_delta') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                 THEN (te.event_payload->>'score_delta')::numeric
                 ELSE 0
               END
             ) AS score_delta,
             COUNT(*) FILTER (
               WHERE te.event_type <> 'provider_listing_expired'
               AND LOWER(COALESCE(te.event_payload->>'analytics_only', 'false')) <> 'true'
               AND (
                 COALESCE((te.event_payload->>'failure_delta')::int, 0) > 0
                 OR COALESCE((te.event_payload->>'timeout_delta')::int, 0) > 0
                 OR COALESCE((te.event_payload->>'cancellation_delta')::int, 0) > 0
               )
             )::int AS negative_events,
             MAX(te.created_at) AS last_negative_at,
             ts.trust_score, ts.risk_category, ts.projected_restriction_level
      FROM trust_events te
      LEFT JOIN trust_scores ts
        ON ts.subject_type=te.subject_type
        AND ts.subject_id=te.subject_id
      WHERE ${eventFilter}
      GROUP BY te.subject_type, te.subject_id, ts.trust_score, ts.risk_category,
               ts.projected_restriction_level
      HAVING SUM(
               CASE
                 WHEN te.event_type='provider_listing_expired'
                   OR LOWER(COALESCE(te.event_payload->>'analytics_only', 'false')) = 'true'
                 THEN 0
                 WHEN (te.event_payload->>'score_delta') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                 THEN (te.event_payload->>'score_delta')::numeric
                 ELSE 0
               END
             ) < 0
         OR COUNT(*) FILTER (
              WHERE te.event_type <> 'provider_listing_expired'
              AND LOWER(COALESCE(te.event_payload->>'analytics_only', 'false')) <> 'true'
              AND (
                COALESCE((te.event_payload->>'failure_delta')::int, 0) > 0
                OR COALESCE((te.event_payload->>'timeout_delta')::int, 0) > 0
                OR COALESCE((te.event_payload->>'cancellation_delta')::int, 0) > 0
              )
            ) > 0
      ORDER BY score_delta ASC, negative_events DESC, last_negative_at DESC
      LIMIT $${eventParams.length + 1}
      `,
      [...eventParams, limit]
    ),
    db.query(
      `
      SELECT subject_type, subject_id, trust_score, penalty_level, risk_category,
             success_streak, recovery_progress, last_success_at, recovery_state
      FROM trust_scores ts
      WHERE ${scoreFilter}
      AND (success_streak > 0 OR recovery_progress > 0)
      ORDER BY success_streak DESC, recovery_progress DESC, last_success_at DESC NULLS LAST
      LIMIT $${scoreParams.length + 1}
      `,
      [...scoreParams, limit]
    ),
    db.query(
      `
      SELECT subject_type, subject_id, COUNT(*)::int AS timeout_events,
             MAX(created_at) AS last_timeout_at
      FROM trust_events te
      WHERE ${eventFilter}
      AND event_type IN ('payment_timeout', 'user_payment_timeout')
      GROUP BY subject_type, subject_id
      HAVING COUNT(*) > 1
      ORDER BY timeout_events DESC, last_timeout_at DESC
      LIMIT $${eventParams.length + 1}
      `,
      [...eventParams, limit]
    ),
    db.query(
      `
      SELECT subject_type, subject_id, COUNT(*)::int AS cancellation_events,
             MAX(created_at) AS last_cancellation_at
      FROM trust_events te
      WHERE ${eventFilter}
      AND event_type IN ('user_cancelled_reservation', 'ngo_cancelled_reservation')
      GROUP BY subject_type, subject_id
      HAVING COUNT(*) > 1
      ORDER BY cancellation_events DESC, last_cancellation_at DESC
      LIMIT $${eventParams.length + 1}
      `,
      [...eventParams, limit]
    ),
    filters.actorType && filters.actorType !== "provider"
      ? Promise.resolve({ rows: [] })
      : db.query(
          `
          SELECT date_trunc('day', created_at)::date AS bucket,
                 COUNT(*) FILTER (WHERE event_type='provider_successful_fulfillment')::int AS fulfillments,
                 COUNT(*) FILTER (WHERE event_type='provider_report_validated')::int AS validated_reports,
                 COUNT(*) FILTER (WHERE event_type='provider_listing_expired')::int AS listing_expiry_observations,
                 COUNT(DISTINCT subject_id)::int AS providers_observed
          FROM trust_events te
          WHERE subject_type='provider'
          AND ${eventFilter}
          GROUP BY bucket
          ORDER BY bucket ASC
          `,
          eventParams
        ),
    filters.actorType && filters.actorType !== "volunteer"
      ? Promise.resolve({ rows: [] })
      : db.query(
          `
          SELECT date_trunc('day', created_at)::date AS bucket,
                 COUNT(*) FILTER (WHERE event_type='volunteer_delivery_completed')::int AS completed_deliveries,
                 COUNT(*) FILTER (
                   WHERE event_type IN ('volunteer_delivery_failed','volunteer_assignment_timeout')
                 )::int AS delivery_failures,
                 COUNT(DISTINCT subject_id)::int AS volunteers_observed
          FROM trust_events te
          WHERE subject_type='volunteer'
          AND ${eventFilter}
          GROUP BY bucket
          ORDER BY bucket ASC
          `,
          eventParams
        ),
  ]);

  return {
    filters,
    highestRiskActors: highestRiskActors.rows,
    rapidlyDegradingActors: rapidlyDegradingActors.rows,
    recoveryStreaks: recoveryStreaks.rows,
    repeatedPaymentTimeoutPatterns: paymentTimeoutPatterns.rows,
    repeatedCancellationPatterns: cancellationPatterns.rows,
    providerOperationalHealthTrends: providerOperationalHealth.rows,
    volunteerDeliveryReliabilityTrends: volunteerDeliveryReliability.rows,
  };
}

async function getTrustAnomalySummary(options = {}) {
  const db = options.db || pool;
  const filters = normalizeTrustFilters(options);
  const staleMinutes = boundedInt(options.staleMinutes || options.stale_minutes, 15, 1, 1440);
  const params = [];
  const actorPredicate = filters.actorType ? `AND te.subject_type=${addParam(params, filters.actorType)}` : "";

  const stale = await db.query(
    `
    SELECT te.subject_type, te.subject_id, MAX(te.created_at) AS newest_event_at,
           ts.last_event_at, ts.updated_at
    FROM trust_events te
    LEFT JOIN trust_scores ts
      ON ts.subject_type=te.subject_type
      AND ts.subject_id=te.subject_id
    WHERE te.processing_status='processed'
    ${actorPredicate}
    GROUP BY te.subject_type, te.subject_id, ts.last_event_at, ts.updated_at
    HAVING ts.subject_id IS NULL
       OR MAX(te.created_at) > COALESCE(ts.last_event_at, TIMESTAMP 'epoch')
         + ($${params.length + 1}::int * INTERVAL '1 minute')
    ORDER BY newest_event_at DESC
    LIMIT $${params.length + 2}
    `,
    [...params, staleMinutes, filters.limit]
  );

  const orphanParams = [];
  const orphanActorPredicate = filters.actorType
    ? `AND te.subject_type=${addParam(orphanParams, filters.actorType)}`
    : "";
  const orphaned = await db.query(
    `
    SELECT te.id, te.event_key, te.subject_type, te.subject_id, te.event_type,
           te.processing_status, te.created_at
    FROM trust_events te
    LEFT JOIN trust_event_effects tee
      ON tee.event_id=te.id
      AND tee.subject_type=te.subject_type
      AND tee.subject_id=te.subject_id
    WHERE te.processing_status='processed'
    AND tee.event_id IS NULL
    ${orphanActorPredicate}
    ORDER BY te.created_at DESC, te.id DESC
    LIMIT $${orphanParams.length + 1}
    `,
    [...orphanParams, filters.limit]
  );

  const duplicateParams = [];
  const duplicateWhere = eventWhere(filters, duplicateParams);
  const duplicateSources = await db.query(
    `
    SELECT source_type, source_id, event_type, subject_type, subject_id,
           COUNT(*)::int AS duplicate_count,
           MAX(created_at) AS last_seen_at
    FROM trust_events te
    WHERE ${duplicateWhere}
    GROUP BY source_type, source_id, event_type, subject_type, subject_id
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, last_seen_at DESC
    LIMIT $${duplicateParams.length + 1}
    `,
    [...duplicateParams, filters.limit]
  );

  setGauge("food_rescue_trust_stale_projections", {}, stale.rows.length);
  setGauge("food_rescue_trust_orphaned_processed_events", {}, orphaned.rows.length);
  setGauge("food_rescue_trust_duplicate_source_groups", {}, duplicateSources.rows.length);

  return {
    staleProjections: stale.rows,
    orphanedProcessedEvents: orphaned.rows,
    duplicateSourceGroups: duplicateSources.rows,
  };
}

async function getTrustQueueObservability(options = {}) {
  const db = options.db || pool;
  const staleMinutes = boundedInt(options.staleMinutes || options.stale_minutes, 15, 1, 1440);
  const [processing, retries] = await Promise.all([
    db.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE processing_status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE processing_status='retry')::int AS retry,
        COUNT(*) FILTER (WHERE processing_status='processing')::int AS processing,
        COUNT(*) FILTER (WHERE processing_status='failed')::int AS failed,
        COUNT(*) FILTER (
          WHERE processing_status IN ('pending','retry')
          AND created_at < NOW() - ($1::int * INTERVAL '1 minute')
        )::int AS stale_unprocessed,
        EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) * 1000 AS replay_lag_ms
      FROM trust_events
      WHERE processing_status IN ('pending','retry','processing','failed')
      `,
      [staleMinutes]
    ),
    db.query(
      `
      SELECT event_type, subject_type, processing_status,
             COUNT(*)::int AS events,
             SUM(attempt_count)::int AS attempts
      FROM trust_events
      WHERE processing_status IN ('retry','failed')
      GROUP BY event_type, subject_type, processing_status
      ORDER BY events DESC, attempts DESC
      LIMIT 50
      `
    ),
  ]);
  const processingRow = processing.rows[0] || {};

  setGauge("food_rescue_trust_replay_lag_ms", {}, Number(processingRow.replay_lag_ms || 0));
  setGauge("food_rescue_trust_replay_retry_events", {}, Number(processingRow.retry || 0));

  return {
    processing: processingRow,
    retryBreakdown: retries.rows,
    metrics: getMetricsSnapshot().samples,
  };
}

async function getTrustDiagnostics(options = {}) {
  const db = options.db || pool;
  const filters = normalizeTrustFilters(options);
  const sampleLimit = boundedInt(options.sampleLimit || options.sample_limit, 10, 1, 25);
  const staleMinutes = boundedInt(options.staleMinutes || options.stale_minutes, 15, 1, 1440);
  const scoreParams = [];
  const scoreFilter = scoreWhere(filters, scoreParams);
  const startedAt = Date.now();

  const [sampleSubjects, anomalies, queue] = await Promise.all([
    db.query(
      `
      SELECT subject_type, subject_id
      FROM trust_scores ts
      WHERE ${scoreFilter}
      ORDER BY updated_at DESC
      LIMIT $${scoreParams.length + 1}
      `,
      [...scoreParams, sampleLimit]
    ),
    getTrustAnomalySummary({ db, ...filters, staleMinutes }),
    getTrustQueueObservability({ db, staleMinutes }),
  ]);

  const replayChecks = [];
  for (const subject of sampleSubjects.rows) {
    const { score, events } = await loadSubjectProjection(
      db,
      subject.subject_type,
      subject.subject_id
    );
    const diagnostics = buildReplayDiagnostics({
      events,
      storedProjection: score,
      subjectType: subject.subject_type,
      subjectId: subject.subject_id,
    });
    replayChecks.push({
      subjectType: subject.subject_type,
      subjectId: subject.subject_id,
      eventCount: events.length,
      consistent: diagnostics.consistent,
      mismatchCount: diagnostics.mismatchCount,
      replayChecksum: diagnostics.replayChecksum,
      storedProjectionChecksum: diagnostics.storedProjectionChecksum,
      replayProjectionChecksum: diagnostics.replayProjectionChecksum,
    });
  }

  const inconsistent = replayChecks.filter((item) => !item.consistent).length;
  setGauge("food_rescue_trust_replay_inconsistent_samples", {}, inconsistent);
  incrementCounter("food_rescue_trust_replay_diagnostics_total", {
    subject_type: filters.actorType || "all",
    consistent: inconsistent === 0 ? "true" : "false",
  });
  if (inconsistent > 0) {
    incrementCounter("food_rescue_trust_replay_checksum_mismatches_total", {
      subject_type: filters.actorType || "all",
    }, inconsistent);
  }

  return {
    filters,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    replayChecks,
    anomalies,
    queue,
  };
}

module.exports = {
  buildReplayDiagnostics,
  buildReplayLineage,
  compareProjectionSnapshot,
  getRecentTrustEvents,
  getTrustAnalytics,
  getTrustAnomalySummary,
  getTrustDiagnostics,
  getTrustObservabilitySummary,
  getTrustProjectionBreakdown,
  getTrustQueueObservability,
  normalizeTrustFilters,
  projectionChecksum,
  trustReplayChecksum,
};
