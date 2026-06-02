const pool = require("../config/db");
const logger = require("../utils/logger");
const {
  SYSTEM_SUBJECT_ID,
  appendTrustEventIfMissing,
  isUuid,
} = require("./trustEvent.service");
const {
  incrementCounter,
  observeHistogram,
} = require("./metrics.service");
const {
  recordOperationalEvent,
} = require("./observability.service");

const TRUST_EVENT_RULES = {
  user_pickup_completed: { score_delta: 3, completion_delta: 1 },
  user_pickup_failed: { score_delta: -10, failure_delta: 1 },
  user_payment_timeout: { score_delta: -5, failure_delta: 1, timeout_delta: 1 },
  user_cancelled_reservation: { score_delta: -2, cancellation_delta: 1 },
  user_refund_completed: { score_delta: 1, refund_delta: 1 },

  ngo_delivery_completed: { score_delta: 3, completion_delta: 1 },
  ngo_delivery_failed: { score_delta: -10, failure_delta: 1 },
  ngo_cancelled_reservation: { score_delta: -2, cancellation_delta: 1 },
  ngo_unpicked_expired: { score_delta: -8, failure_delta: 1, timeout_delta: 1 },

  volunteer_delivery_completed: { score_delta: 4, completion_delta: 1 },
  volunteer_delivery_failed: { score_delta: -12, failure_delta: 1, timeout_delta: 1 },
  volunteer_assignment_timeout: { score_delta: -8, failure_delta: 1, timeout_delta: 1 },

  provider_listing_expired: { analytics_only: true, trust_impact: "neutral" },
  provider_report_validated: { score_delta: -15, failure_delta: 1 },
  provider_successful_fulfillment: { score_delta: 2, fulfillment_delta: 1 },
  verified_good_behavior: { score_delta: 2, completion_delta: 1 },

  payment_timeout: { timeout_delta: 1 },
  payment_reconciled: {},
  refund_processed: { refund_delta: 1 },
};

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function sourceMetadata(row, extra = {}) {
  return {
    reservation_id: row.reservation_id || (row.pickup_type || row.task_status ? row.id : null),
    payment_id: row.payment_id || (row.reservation_id ? row.id : null),
    listing_id: row.listing_id || null,
    provider_id: row.provider_id || null,
    is_free: row.is_free ?? row.listing_is_free ?? null,
    food_amount: row.food_amount ?? row.reservation_amount ?? null,
    total_amount: row.total_amount ?? null,
    system_generated: row.system_generated ?? false,
    internal: row.internal ?? false,
    status: row.status || row.reservation_status || null,
    task_status: row.task_status || null,
    payment_status: row.payment_status || null,
    payment_row_status: row.payment_row_status || row.status || null,
    source_lineage: extra.sourceLineage,
    ...extra,
  };
}

function payloadFor(eventType, row, extra = {}) {
  return {
    ...(TRUST_EVENT_RULES[eventType] || {}),
    metadata: sourceMetadata(row, extra),
  };
}

function makeEvent({
  eventKey,
  subjectType,
  subjectId,
  sourceType,
  sourceId,
  reservationId = null,
  paymentId = null,
  eventType,
  row,
  extra = {},
}) {
  if (!isUuid(subjectId)) return null;

  return {
    eventKey,
    subjectType,
    subjectId,
    sourceType,
    sourceId: String(sourceId),
    reservationId,
    paymentId,
    eventType,
    eventPayload: payloadFor(eventType, row, extra),
  };
}

function isCompletedReservation(row) {
  const status = normalizeStatus(row.status);
  const taskStatus = normalizeStatus(row.task_status);
  return (
    Boolean(row.completed_at) ||
    ["picked_up", "completed", "delivered"].includes(status) ||
    ["picked_up", "completed", "delivered"].includes(taskStatus)
  );
}

function isCancelledReservation(row) {
  return ["cancelled", "cancelled_before_confirmation"].includes(
    normalizeStatus(row.status)
  );
}

function isPaymentTimeoutReservation(row) {
  return (
    ["expired_payment", "payment_failed"].includes(normalizeStatus(row.status)) ||
    normalizeStatus(row.payment_status) === "expired" ||
    normalizeStatus(row.payment_row_status) === "expired"
  );
}

function isExpiredReservation(row) {
  return normalizeStatus(row.status) === "expired";
}

function buildReservationTrustEvents(row) {
  const events = [];
  const reservationId = row.id;
  const paymentId = row.payment_id || null;
  const pickupType = normalizeStatus(row.pickup_type);

  if (isCompletedReservation(row)) {
    if (pickupType === "self_pickup") {
      events.push(
        makeEvent({
          eventKey: `reservation:${reservationId}:user_pickup_completed:${row.user_id}`,
          subjectType: "user",
          subjectId: row.user_id,
          sourceType: "reservation",
          sourceId: reservationId,
          reservationId,
          paymentId,
          eventType: "user_pickup_completed",
          row,
          extra: { sourceLineage: "reservation.completed.self_pickup" },
        })
      );
    }

    if (pickupType === "ngo") {
      events.push(
        makeEvent({
          eventKey: `reservation:${reservationId}:ngo_delivery_completed:${row.user_id}`,
          subjectType: "ngo",
          subjectId: row.user_id,
          sourceType: "reservation",
          sourceId: reservationId,
          reservationId,
          paymentId,
          eventType: "ngo_delivery_completed",
          row,
          extra: { sourceLineage: "reservation.completed.ngo_delivery" },
        })
      );

      if (row.assigned_volunteer_id) {
        events.push(
          makeEvent({
            eventKey: `reservation:${reservationId}:volunteer_delivery_completed:${row.assigned_volunteer_id}`,
            subjectType: "volunteer",
            subjectId: row.assigned_volunteer_id,
            sourceType: "reservation",
            sourceId: reservationId,
            reservationId,
            paymentId,
            eventType: "volunteer_delivery_completed",
            row,
            extra: { sourceLineage: "reservation.completed.volunteer_delivery" },
          })
        );
      }
    }

    events.push(
      makeEvent({
        eventKey: `reservation:${reservationId}:provider_successful_fulfillment:${row.provider_id}`,
        subjectType: "provider",
        subjectId: row.provider_id,
        sourceType: "reservation",
        sourceId: reservationId,
        reservationId,
        paymentId,
        eventType: "provider_successful_fulfillment",
        row,
        extra: { sourceLineage: "reservation.completed.provider_fulfillment" },
      })
    );
  }

  if (isCancelledReservation(row)) {
    const isNgo = pickupType === "ngo";
    events.push(
      makeEvent({
        eventKey: `reservation:${reservationId}:${isNgo ? "ngo" : "user"}_cancelled_reservation:${row.user_id}`,
        subjectType: isNgo ? "ngo" : "user",
        subjectId: row.user_id,
        sourceType: "reservation",
        sourceId: reservationId,
        reservationId,
        paymentId,
        eventType: isNgo ? "ngo_cancelled_reservation" : "user_cancelled_reservation",
        row,
        extra: { sourceLineage: "reservation.cancelled" },
      })
    );
  }

  if (isPaymentTimeoutReservation(row)) {
    if (pickupType === "self_pickup") {
      events.push(
        makeEvent({
          eventKey: `reservation:${reservationId}:user_payment_timeout:${row.user_id}`,
          subjectType: "user",
          subjectId: row.user_id,
          sourceType: "reservation",
          sourceId: reservationId,
          reservationId,
          paymentId,
          eventType: "user_payment_timeout",
          row,
          extra: { sourceLineage: "reservation.payment_timeout" },
        })
      );
    }

    events.push(
      makeEvent({
        eventKey: `reservation:${reservationId}:payment_timeout:${paymentId || "missing_payment"}`,
        subjectType: "system",
        subjectId: SYSTEM_SUBJECT_ID,
        sourceType: paymentId ? "payment" : "reservation",
        sourceId: paymentId || reservationId,
        reservationId,
        paymentId,
        eventType: "payment_timeout",
        row,
        extra: { sourceLineage: "reservation.payment_timeout.system" },
      })
    );
  }

  if (isExpiredReservation(row)) {
    if (pickupType === "self_pickup") {
      events.push(
        makeEvent({
          eventKey: `reservation:${reservationId}:user_pickup_failed:${row.user_id}`,
          subjectType: "user",
          subjectId: row.user_id,
          sourceType: "reservation",
          sourceId: reservationId,
          reservationId,
          paymentId,
          eventType: "user_pickup_failed",
          row,
          extra: { sourceLineage: "reservation.expired.self_pickup" },
        })
      );
    }

    if (pickupType === "ngo") {
      const volunteerFailureType = row.picked_up_at
        ? "volunteer_delivery_failed"
        : "volunteer_assignment_timeout";
      const ngoFailureType =
        normalizeStatus(row.task_status) === "failed"
          ? "ngo_delivery_failed"
          : "ngo_unpicked_expired";

      events.push(
        makeEvent({
          eventKey: `reservation:${reservationId}:${ngoFailureType}:${row.user_id}`,
          subjectType: "ngo",
          subjectId: row.user_id,
          sourceType: "reservation",
          sourceId: reservationId,
          reservationId,
          paymentId,
          eventType: ngoFailureType,
          row,
          extra: { sourceLineage: "reservation.expired.ngo" },
        })
      );

      if (row.assigned_volunteer_id && normalizeStatus(row.task_status) === "failed") {
        events.push(
          makeEvent({
            eventKey: `reservation:${reservationId}:${volunteerFailureType}:${row.assigned_volunteer_id}`,
            subjectType: "volunteer",
            subjectId: row.assigned_volunteer_id,
            sourceType: "reservation",
            sourceId: reservationId,
            reservationId,
            paymentId,
            eventType: volunteerFailureType,
            row,
            extra: { sourceLineage: "reservation.expired.volunteer" },
          })
        );
      }
    }
  }

  return events.filter(Boolean);
}

function buildPaymentTrustEvents(row) {
  const events = [];
  const paymentId = row.id || row.payment_id;
  const reservationId = row.reservation_id || null;
  const status = normalizeStatus(row.status || row.payment_row_status);
  const refundStatus = normalizeStatus(row.refund_status);
  const isRefundFinal =
    ["refunded", "refund_failed"].includes(status) ||
    ["refunded", "refund_failed"].includes(refundStatus);
  const isReconciled =
    Boolean(row.last_reconciled_at) &&
    ["paid", "failed", "expired", "refunded", "refund_failed"].includes(status);

  if (isReconciled) {
    events.push(
      makeEvent({
        eventKey: `payment:${paymentId}:payment_reconciled`,
        subjectType: "system",
        subjectId: SYSTEM_SUBJECT_ID,
        sourceType: "payment",
        sourceId: paymentId,
        reservationId,
        paymentId,
        eventType: "payment_reconciled",
        row,
        extra: { sourceLineage: "payment.reconciled" },
      })
    );
  }

  if (isRefundFinal) {
    events.push(
      makeEvent({
        eventKey: `payment:${paymentId}:refund_processed:${reservationId || "missing_reservation"}`,
        subjectType: "system",
        subjectId: SYSTEM_SUBJECT_ID,
        sourceType: "payment",
        sourceId: paymentId,
        reservationId,
        paymentId,
        eventType: "refund_processed",
        row,
        extra: { sourceLineage: "payment.refund_processed" },
      })
    );

    if (normalizeStatus(row.pickup_type) === "self_pickup" && row.user_id) {
      events.push(
        makeEvent({
          eventKey: `payment:${paymentId}:user_refund_completed:${row.user_id}`,
          subjectType: "user",
          subjectId: row.user_id,
          sourceType: "payment",
          sourceId: paymentId,
          reservationId,
          paymentId,
          eventType: "user_refund_completed",
          row,
          extra: { sourceLineage: "payment.user_refund_completed" },
        })
      );
    }
  }

  return events.filter(Boolean);
}

function buildProviderReportTrustEvents(row) {
  if (normalizeStatus(row.status) !== "validated") return [];

  return [
    makeEvent({
      eventKey: `provider_report:${row.id}:provider_report_validated:${row.provider_id}`,
      subjectType: "provider",
      subjectId: row.provider_id,
      sourceType: "provider_report",
      sourceId: row.id,
      reservationId: row.reservation_id || null,
      eventType: "provider_report_validated",
      row,
      extra: {
        sourceLineage: "provider_report.validated",
        reason: row.reason || null,
      },
    }),
  ].filter(Boolean);
}

function buildListingTrustEvents(row) {
  if (normalizeStatus(row.status) !== "expired") return [];

  return [
    makeEvent({
      eventKey: `listing:${row.id}:provider_listing_expired:${row.provider_id}`,
      subjectType: "provider",
      subjectId: row.provider_id,
      sourceType: "food_listing",
      sourceId: row.id,
      eventType: "provider_listing_expired",
      row,
      extra: { sourceLineage: "listing.expired" },
    }),
  ].filter(Boolean);
}

async function emitBuiltEvents(events, options = {}) {
  const append = options.appendTrustEvent || appendTrustEventIfMissing;
  const results = [];

  for (const event of events) {
    const startedAt = Date.now();
    const result = await append(event, {
      db: options.db,
      queue: options.queue,
      enqueue: options.enqueue,
      recordOperationalEvent: false,
    });
    const outcome = result.inserted ? "emitted" : "deduplicated";

    incrementCounter("food_rescue_trust_derived_events_total", {
      event_type: event.eventType,
      subject_type: event.subjectType,
      result: outcome,
    });
    observeHistogram("food_rescue_trust_derivation_emit_duration_ms", {}, Date.now() - startedAt);

    results.push({
      eventKey: event.eventKey,
      eventType: event.eventType,
      subjectType: event.subjectType,
      inserted: result.inserted,
    });
  }

  return results;
}

async function queryRows(db, sql, params) {
  const result = await db.query(sql, params);
  return result.rows;
}

async function deriveReservationEvents(options = {}) {
  const db = options.db || pool;
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const lookbackDays = Math.max(1, Number(options.lookbackDays || process.env.TRUST_DERIVATION_LOOKBACK_DAYS || 30));
  const rows = await queryRows(
    db,
    `
    SELECT r.id, r.user_id, r.listing_id, r.pickup_type, r.status, r.task_status,
           r.assigned_volunteer_id, r.completed_at, r.picked_up_at,
           r.payment_status, r.payment_expires_at, r.reserved_at,
           f.provider_id, f.is_free, f.price,
           p.id AS payment_id,
           p.food_amount,
           p.total_amount,
           p.status AS payment_row_status,
           p.refund_status
    FROM reservations r
    JOIN food_listings f ON f.id=r.listing_id
    LEFT JOIN LATERAL (
      SELECT id, status, refund_status
      FROM payments
      WHERE reservation_id=r.id
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
    ) p ON true
    WHERE r.reserved_at >= NOW() - ($2::int * INTERVAL '1 day')
    AND (
      r.completed_at IS NOT NULL
      OR r.status IN (
        'picked_up', 'completed', 'delivered', 'expired', 'cancelled',
        'cancelled_before_confirmation', 'expired_payment', 'payment_failed'
      )
      OR r.payment_status IN ('refunded', 'expired', 'failed')
    )
    ORDER BY COALESCE(r.completed_at, r.picked_up_at, r.reserved_at) DESC
    LIMIT $1
    `,
    [limit, lookbackDays]
  );

  return emitBuiltEvents(rows.flatMap(buildReservationTrustEvents), options);
}

async function derivePaymentEvents(options = {}) {
  const db = options.db || pool;
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const lookbackDays = Math.max(1, Number(options.lookbackDays || process.env.TRUST_DERIVATION_LOOKBACK_DAYS || 30));
  const rows = await queryRows(
    db,
    `
    SELECT p.id, p.reservation_id, p.status, p.refund_status,
           p.reconciliation_status, p.last_reconciled_at, p.updated_at,
           r.user_id, r.pickup_type, r.status AS reservation_status,
           r.payment_status, f.provider_id
    FROM payments p
    LEFT JOIN reservations r ON r.id=p.reservation_id
    LEFT JOIN food_listings f ON f.id=r.listing_id
    WHERE p.updated_at >= NOW() - ($2::int * INTERVAL '1 day')
    AND (
      (p.last_reconciled_at IS NOT NULL AND p.status IN ('paid','failed','expired','refunded','refund_failed'))
      OR p.status IN ('refunded','refund_failed')
      OR p.refund_status IN ('refunded','refund_failed')
    )
    ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
    LIMIT $1
    `,
    [limit, lookbackDays]
  );

  return emitBuiltEvents(rows.flatMap(buildPaymentTrustEvents), options);
}

async function deriveProviderReportEvents(options = {}) {
  const db = options.db || pool;
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const lookbackDays = Math.max(1, Number(options.lookbackDays || process.env.TRUST_DERIVATION_LOOKBACK_DAYS || 30));
  const rows = await queryRows(
    db,
    `
    SELECT id, provider_id, reported_by, reservation_id, reason, status, resolved_at, created_at
    FROM provider_reports
    WHERE status='validated'
    AND COALESCE(resolved_at, created_at) >= NOW() - ($2::int * INTERVAL '1 day')
    ORDER BY COALESCE(resolved_at, created_at) DESC, id DESC
    LIMIT $1
    `,
    [limit, lookbackDays]
  );

  return emitBuiltEvents(rows.flatMap(buildProviderReportTrustEvents), options);
}

async function deriveListingEvents(options = {}) {
  const db = options.db || pool;
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const lookbackDays = Math.max(1, Number(options.lookbackDays || process.env.TRUST_DERIVATION_LOOKBACK_DAYS || 30));
  const rows = await queryRows(
    db,
    `
    SELECT id, provider_id, status, pickup_end_time, created_at
    FROM food_listings
    WHERE status='expired'
    AND pickup_end_time >= NOW() - ($2::int * INTERVAL '1 day')
    ORDER BY pickup_end_time DESC, id DESC
    LIMIT $1
    `,
    [limit, lookbackDays]
  );

  return emitBuiltEvents(rows.flatMap(buildListingTrustEvents), options);
}

async function deriveLifecycleTrustEvents(options = {}) {
  const startedAt = Date.now();
  const sources = [
    ["reservation", deriveReservationEvents],
    ["payment", derivePaymentEvents],
    ["provider_report", deriveProviderReportEvents],
    ["listing", deriveListingEvents],
  ];
  const summary = [];

  for (const [source, derive] of sources) {
    try {
      const results = await derive(options);
      summary.push({
        source,
        emitted: results.filter((result) => result.inserted).length,
        deduplicated: results.filter((result) => !result.inserted).length,
      });
    } catch (err) {
      logger.warn("Trust lifecycle derivation source failed", { err, source });
      summary.push({ source, failed: true, message: err.message });
    }
  }

  observeHistogram("food_rescue_trust_derivation_duration_ms", {}, Date.now() - startedAt);
  if (options.recordOperationalEvent !== false) {
    void recordOperationalEvent({
      category: "trust",
      severity: summary.some((item) => item.failed) ? "warning" : "info",
      eventName: "trust_lifecycle_derivation_completed",
      metadata: { summary },
    });
  }

  return summary;
}

module.exports = {
  SYSTEM_SUBJECT_ID,
  TRUST_EVENT_RULES,
  buildListingTrustEvents,
  buildPaymentTrustEvents,
  buildProviderReportTrustEvents,
  buildReservationTrustEvents,
  deriveLifecycleTrustEvents,
  emitBuiltEvents,
};
