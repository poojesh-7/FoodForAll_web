const crypto = require("crypto");
const pool = require("../config/db");
const logger = require("../utils/logger");
const {
  incrementCounter,
  observeHistogram,
  setGauge,
} = require("./metrics.service");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");
const { jobOptions } = require("../utils/queueOptions");

const SYSTEM_SUBJECT_ID = "00000000-0000-4000-8000-000000000000";
const SUBJECT_TYPES = new Set(["user", "ngo", "volunteer", "provider", "system"]);
const PROCESSABLE_STATUSES = ["pending", "retry"];
const MAX_ATTEMPTS = Number(process.env.TRUST_EVENT_MAX_ATTEMPTS || 5);

function getDefaultTrustQueue() {
  return require("../../queues/trust.queue");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function compactText(value, maxLength = 160) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload;
}

function normalizeTrustEvent(input = {}) {
  const eventKey = compactText(input.eventKey || input.event_key, 240);
  const subjectType = compactText(input.subjectType || input.subject_type, 40);
  const subjectId = input.subjectId || input.subject_id;
  const sourceType = compactText(input.sourceType || input.source_type, 80);
  const sourceId = compactText(input.sourceId || input.source_id, 160);
  const eventType = compactText(input.eventType || input.event_type, 120);
  const reservationId = input.reservationId || input.reservation_id || null;
  const paymentId = input.paymentId || input.payment_id || null;

  if (!eventKey) throw new Error("Trust event key is required");
  if (!SUBJECT_TYPES.has(subjectType)) throw new Error("Invalid trust subject type");
  if (!isUuid(subjectId)) throw new Error("Trust subject id must be a UUID");
  if (!sourceType) throw new Error("Trust event source type is required");
  if (!sourceId) throw new Error("Trust event source id is required");
  if (!eventType) throw new Error("Trust event type is required");
  if (reservationId && !isUuid(reservationId)) throw new Error("Trust reservation id must be a UUID");
  if (paymentId && !isUuid(paymentId)) throw new Error("Trust payment id must be a UUID");

  return {
    eventKey,
    subjectType,
    subjectId: String(subjectId),
    sourceType,
    sourceId,
    reservationId: reservationId ? String(reservationId) : null,
    paymentId: paymentId ? String(paymentId) : null,
    eventType,
    eventPayload: normalizePayload(input.eventPayload || input.event_payload),
  };
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

async function enqueueTrustProcessing(eventKey, options = {}) {
  const queue = options.queue === undefined ? getDefaultTrustQueue() : options.queue;
  if (!queue) return null;

  return queue.add(
    "process-trust-events",
    { eventKey },
    jobOptions("operational", {
      jobId: `trust:${eventKey}`,
    })
  );
}

async function appendTrustEvent(input, options = {}) {
  const event = normalizeTrustEvent(input);
  const db = options.db || pool;
  const inserted = await db.query(
    `
    INSERT INTO trust_events (
      event_key, subject_type, subject_id, source_type, source_id,
      reservation_id, payment_id, event_type, event_payload
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (event_key) DO NOTHING
    RETURNING *
    `,
    [
      event.eventKey,
      event.subjectType,
      event.subjectId,
      event.sourceType,
      event.sourceId,
      event.reservationId,
      event.paymentId,
      event.eventType,
      JSON.stringify(event.eventPayload),
    ]
  );

  const row = inserted.rows[0] || null;
  const insertedEvent = Boolean(row);

  incrementCounter("food_rescue_trust_events_ingested_total", {
    event_type: event.eventType,
    subject_type: event.subjectType,
    result: insertedEvent ? "inserted" : "duplicate",
  });

  if (!insertedEvent) {
    incrementCounter("food_rescue_trust_duplicate_events_total", {
      event_type: event.eventType,
      subject_type: event.subjectType,
    });
    logger.debug("Duplicate trust event skipped", {
      eventKey: event.eventKey,
      eventType: event.eventType,
      subjectType: event.subjectType,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
    });
  }

  if (insertedEvent && options.enqueue !== false) {
    await enqueueTrustProcessing(event.eventKey, options).catch((err) => {
      logger.warn("Trust event enqueue failed", { err, eventKey: event.eventKey });
      void recordAlert({
        alertKey: "trust:event_enqueue_failed",
        category: "trust",
        severity: "warning",
        message: "Trust event enqueue failed",
        metadata: { eventKey: event.eventKey, eventType: event.eventType },
      });
    });
  }

  if (insertedEvent && options.recordOperationalEvent !== false) {
    void recordOperationalEvent({
      category: "trust",
      severity: "info",
      eventName: "trust_event_appended",
      metadata: {
        eventKey: event.eventKey,
        eventType: event.eventType,
        subjectType: event.subjectType,
      },
    });
  }

  return {
    inserted: insertedEvent,
    event: row,
  };
}

async function createTrustEventIfMissing(input, options = {}) {
  return appendTrustEvent(input, options);
}

async function appendTrustEventIfMissing(input, options = {}) {
  return appendTrustEvent(input, options);
}

async function claimTrustEvents(client, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 25), 100));
  const eventKey = compactText(options.eventKey, 240);
  const excludeEventIds = (options.excludeEventIds || [])
    .map((id) => String(id || ""))
    .filter(isUuid);
  const params = eventKey
    ? [eventKey, PROCESSABLE_STATUSES, limit, excludeEventIds]
    : [PROCESSABLE_STATUSES, limit, excludeEventIds];
  const where = eventKey
    ? "event_key=$1 AND processing_status = ANY($2::text[]) AND NOT (id = ANY($4::uuid[]))"
    : "processing_status = ANY($1::text[]) AND NOT (id = ANY($3::uuid[]))";
  const limitParam = eventKey ? "$3" : "$2";

  const result = await client.query(
    `
    SELECT *
    FROM trust_events
    WHERE ${where}
    ORDER BY created_at ASC, id ASC
    LIMIT ${limitParam}
    FOR UPDATE SKIP LOCKED
    `,
    params
  );

  if (result.rows.length) {
    await client.query(
      `
      UPDATE trust_events
      SET processing_status='processing',
          attempt_count=attempt_count + 1,
          last_error=NULL
      WHERE id = ANY($1::uuid[])
      `,
      [result.rows.map((row) => row.id)]
    );

    const oldest = result.rows[0]?.created_at;
    const ageMs = oldest ? Math.max(0, Date.now() - new Date(oldest).getTime()) : 0;
    setGauge("food_rescue_trust_processing_lag_ms", {}, ageMs);
    observeHistogram("food_rescue_trust_event_lag_ms", {}, ageMs);
  }

  return result.rows;
}

async function markTrustEventProcessed(client, eventId) {
  await client.query(
    `
    UPDATE trust_events
    SET processing_status='processed',
        processed_at=NOW(),
        last_error=NULL
    WHERE id=$1
    `,
    [eventId]
  );
  incrementCounter("food_rescue_trust_events_processed_total", { status: "processed" });
}

async function markTrustEventRetry(client, event, err, options = {}) {
  const maxAttempts = Number(options.maxAttempts || MAX_ATTEMPTS);
  const nextStatus = Number(event.attempt_count || 0) + 1 >= maxAttempts ? "failed" : "retry";
  const message = String(err?.message || err || "Trust event processing failed").slice(0, 1000);

  await client.query(
    `
    UPDATE trust_events
    SET processing_status=$2,
        last_error=$3,
        processed_at=CASE WHEN $2='failed' THEN NOW() ELSE processed_at END
    WHERE id=$1
    `,
    [event.id, nextStatus, message]
  );

  incrementCounter("food_rescue_trust_events_processed_total", { status: nextStatus });
  if (nextStatus === "retry") {
    incrementCounter("food_rescue_trust_event_retries_total", {
      event_type: event.event_type || "unknown",
    });
  } else {
    void recordAlert({
      alertKey: "trust:event_processing_failed",
      category: "trust",
      severity: "error",
      message: "Trust event processing reached retry limit",
      metadata: {
        eventId: event.id,
        eventKey: event.event_key,
        eventType: event.event_type,
        effectHash: stableHash({
          id: event.id,
          eventKey: event.event_key,
          status: nextStatus,
        }),
      },
    });
  }

  return nextStatus;
}

async function getTrustSubject({ subjectType, subjectId, db = pool }) {
  if (!SUBJECT_TYPES.has(subjectType) || !isUuid(subjectId)) {
    const error = new Error("Invalid trust subject");
    error.statusCode = 400;
    throw error;
  }

  const [score, restrictions, summary, eventTypes, sourceLineage, trend] = await Promise.all([
    db.query(
      `
      SELECT *
      FROM trust_scores
      WHERE subject_type=$1 AND subject_id=$2
      `,
      [subjectType, subjectId]
    ),
    db.query(
      `
      SELECT restriction_type, subject_type, subject_id, active_until, metadata,
             created_at, updated_at
      FROM trust_restrictions
      WHERE subject_type=$1 AND subject_id=$2
      ORDER BY updated_at DESC
      `,
      [subjectType, subjectId]
    ),
    db.query(
      `
      SELECT processing_status, COUNT(*)::int AS count
      FROM trust_events
      WHERE subject_type=$1 AND subject_id=$2
      GROUP BY processing_status
      ORDER BY processing_status
      `,
      [subjectType, subjectId]
    ),
    db.query(
      `
      SELECT event_type, COUNT(*)::int AS count, MAX(created_at) AS last_seen_at
      FROM trust_events
      WHERE subject_type=$1 AND subject_id=$2
      GROUP BY event_type
      ORDER BY count DESC, last_seen_at DESC
      LIMIT 50
      `,
      [subjectType, subjectId]
    ),
    db.query(
      `
      SELECT source_type, COUNT(*)::int AS count, MAX(created_at) AS last_seen_at
      FROM trust_events
      WHERE subject_type=$1 AND subject_id=$2
      GROUP BY source_type
      ORDER BY count DESC, last_seen_at DESC
      LIMIT 20
      `,
      [subjectType, subjectId]
    ),
    db.query(
      `
      SELECT date_trunc('day', created_at)::date AS bucket,
             COUNT(*)::int AS event_count,
             COALESCE(SUM(
               CASE
                 WHEN (event_payload->>'score_delta') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                 THEN (event_payload->>'score_delta')::numeric
                 ELSE 0
               END
             ), 0) AS score_delta,
             COUNT(*) FILTER (
               WHERE COALESCE((event_payload->>'failure_delta')::int, 0) > 0
               OR COALESCE((event_payload->>'timeout_delta')::int, 0) > 0
             )::int AS negative_events,
             COUNT(*) FILTER (
               WHERE COALESCE((event_payload->>'completion_delta')::int, 0) > 0
               OR COALESCE((event_payload->>'fulfillment_delta')::int, 0) > 0
             )::int AS success_events
      FROM trust_events
      WHERE subject_type=$1 AND subject_id=$2
      AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      [subjectType, subjectId]
    ),
  ]);
  const scoreRow = score.rows[0] || null;

  return {
    score: scoreRow,
    scoreBreakdown: scoreRow,
    operationalState: scoreRow
      ? {
          riskCategory: scoreRow.risk_category || "normal",
          projectedRestrictionLevel:
            scoreRow.projected_restriction_level ?? scoreRow.restriction_level ?? 0,
          projectedCooldownUntil:
            scoreRow.projected_cooldown_until ?? scoreRow.cooldown_until ?? null,
          projectedDepositMultiplier:
            scoreRow.projected_deposit_multiplier ?? scoreRow.deposit_multiplier ?? 1,
          recoveryProgress: scoreRow.recovery_progress ?? 100,
          projectedActions: scoreRow.projected_actions || {},
          recoveryState: scoreRow.recovery_state || {},
          decayState: scoreRow.decay_state || {},
          riskState: scoreRow.risk_state || {},
        }
      : null,
    restrictions: restrictions.rows,
    processing: summary.rows,
    derivedMetrics: {
      eventTypes: eventTypes.rows,
      sourceLineage: sourceLineage.rows,
      trend: trend.rows,
    },
  };
}

async function getTrustEvents({ subjectType, subjectId, limit = 100, db = pool }) {
  if (!SUBJECT_TYPES.has(subjectType) || !isUuid(subjectId)) {
    const error = new Error("Invalid trust subject");
    error.statusCode = 400;
    throw error;
  }

  const result = await db.query(
    `
    SELECT id, event_key, subject_type, subject_id, source_type, source_id,
           reservation_id, payment_id, event_type, event_payload,
           processing_status, attempt_count, processed_at, last_error, created_at
    FROM trust_events
    WHERE subject_type=$1 AND subject_id=$2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
    `,
    [subjectType, subjectId, Math.max(1, Math.min(Number(limit || 100), 200))]
  );

  return result.rows;
}

async function getTrustProcessingStats(db = pool) {
  const staleMinutes = Math.max(1, Number(process.env.TRUST_STALE_EVENT_MINUTES || 15));
  const result = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE processing_status='pending')::int AS pending,
      COUNT(*) FILTER (WHERE processing_status='retry')::int AS retry,
      COUNT(*) FILTER (WHERE processing_status='failed')::int AS failed,
      COUNT(*) FILTER (WHERE processing_status='processed')::int AS processed,
      COUNT(*) FILTER (
        WHERE processing_status IN ('pending', 'retry')
        AND created_at < NOW() - ($1::int * INTERVAL '1 minute')
      )::int AS stale_unprocessed,
      EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) * 1000 AS oldest_pending_lag_ms
    FROM trust_events
    WHERE processing_status IN ('pending', 'retry', 'failed', 'processed')
  `, [staleMinutes]);
  const stats = result.rows[0] || {};
  setGauge("food_rescue_trust_events_failed", {}, Number(stats.failed || 0));
  setGauge("food_rescue_trust_events_pending", {}, Number(stats.pending || 0));
  setGauge("food_rescue_trust_events_retry", {}, Number(stats.retry || 0));
  setGauge(
    "food_rescue_trust_events_stale_unprocessed",
    {},
    Number(stats.stale_unprocessed || 0)
  );
  setGauge(
    "food_rescue_trust_processing_lag_ms",
    {},
    Number(stats.oldest_pending_lag_ms || 0)
  );
  return stats;
}

module.exports = {
  MAX_ATTEMPTS,
  SUBJECT_TYPES,
  SYSTEM_SUBJECT_ID,
  appendTrustEventIfMissing,
  appendTrustEvent,
  claimTrustEvents,
  createTrustEventIfMissing,
  enqueueTrustProcessing,
  getTrustEvents,
  getTrustProcessingStats,
  getTrustSubject,
  isUuid,
  markTrustEventProcessed,
  markTrustEventRetry,
  normalizeTrustEvent,
};
