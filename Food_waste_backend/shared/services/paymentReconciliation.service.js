const crypto = require("crypto");
const pool = require("../config/db");
const redis = require("../config/redis");
const cashfree = require("../config/cashfree");
const notificationQueue = require("../../queues/notification.queue");
const refundQueue = require("../../queues/refund.queue");
const logger = require("../utils/logger");
const {
  PaymentError,
  WebhookVerificationError,
} = require("../utils/errors");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");
const generatePickupCode = require("../../utils/codeGenerator");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");
const {
  ensureReservationPaymentContextSchema,
  hasReservedStock,
  parsePaymentContext,
} = require("./reservationPaymentContext.service");
const {
  getReservationSnapshot,
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
} = require("./realtime.service");

const paidStatuses = new Set(["PAID", "SUCCESS"]);
const failedStatuses = new Set(["FAILED", "EXPIRED", "CANCELLED", "USER_DROPPED"]);
const refundedPaymentStates = new Set(["refund_pending", "refunded"]);
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
const WEBHOOK_PROCESSING_LOCK_TTL_SECONDS = 5 * 60;
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const PAYMENT_RECONCILIATION_LIMIT = 100;

let schemaReady;

function toRawBody(body) {
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(JSON.stringify(body || {}), "utf8");
}

function rawBodyToString(rawBody) {
  return Buffer.isBuffer(rawBody)
    ? rawBody.toString("utf8")
    : String(rawBody || "");
}

function getHeaderValue(headers, headerName) {
  const value = headers?.[headerName] || headers?.[headerName.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isFreshWebhookTimestamp(timestamp) {
  if (!timestamp) return false;

  const rawTimestamp = String(timestamp).trim();
  const numericTimestamp = Number(rawTimestamp);
  const timestampMs = Number.isFinite(numericTimestamp)
    ? numericTimestamp > 9999999999
      ? numericTimestamp
      : numericTimestamp * 1000
    : Date.parse(rawTimestamp);

  if (!Number.isFinite(timestampMs)) return false;

  const ageSeconds = Math.abs(Date.now() - timestampMs) / 1000;
  return ageSeconds <= WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyCashfreeWebhookSignature({ rawBody, signature, timestamp }) {
  if (!signature || !timestamp) {
    throw new WebhookVerificationError("Missing Cashfree webhook signature headers");
  }

  if (!process.env.CASHFREE_SECRET_KEY) {
    throw new PaymentError("Cashfree webhook secret is not configured", {
      statusCode: 500,
    });
  }

  if (!isFreshWebhookTimestamp(timestamp)) {
    throw new WebhookVerificationError("Stale Cashfree webhook timestamp");
  }

  const rawBuffer = toRawBody(rawBody);
  const signedPayload = Buffer.concat([
    Buffer.from(String(timestamp), "utf8"),
    rawBuffer,
  ]);
  const expectedSignature = crypto
    .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
    .update(signedPayload)
    .digest("base64");

  if (!timingSafeEqualString(expectedSignature, signature)) {
    throw new WebhookVerificationError("Invalid Cashfree webhook signature");
  }
}

async function ensurePaymentHardeningSchema(client = pool) {
  if (!schemaReady || client !== pool) {
    const run = async () => {
      await ensureRestrictionSchema(client);
      await ensureReservationPaymentContextSchema(client);

      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      await client.query(`
        ALTER TABLE reservations
        ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMP NULL
      `);

      await client.query(`
        ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS transaction_id TEXT NULL,
        ADD COLUMN IF NOT EXISTS payment_method TEXT NULL,
        ADD COLUMN IF NOT EXISTS refund_id TEXT NULL,
        ADD COLUMN IF NOT EXISTS refund_status TEXT NULL,
        ADD COLUMN IF NOT EXISTS gateway_status TEXT NULL,
        ADD COLUMN IF NOT EXISTS last_webhook_event_key TEXT NULL,
        ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NULL,
        ADD COLUMN IF NOT EXISTS reconciliation_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS refund_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reliability_deposit_refund_attempts INTEGER DEFAULT 0
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS cashfree_webhook_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          idempotency_key TEXT NOT NULL UNIQUE,
          event_type TEXT NULL,
          order_id TEXT NULL,
          cf_payment_id TEXT NULL,
          refund_id TEXT NULL,
          status TEXT NOT NULL DEFAULT 'processing',
          attempts INTEGER NOT NULL DEFAULT 1,
          payload JSONB NOT NULL,
          payload_hash TEXT NOT NULL,
          signature TEXT NULL,
          webhook_timestamp TEXT NULL,
          received_at TIMESTAMP NOT NULL DEFAULT NOW(),
          processed_at TIMESTAMP NULL,
          failure_reason TEXT NULL
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_events_order
        ON cashfree_webhook_events (order_id, received_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_events_status
        ON cashfree_webhook_events (status, received_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payments_order_status
        ON payments (order_id, status)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payments_reservation
        ON payments (reservation_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reservations_pending_payment
        ON reservations (payment_status, status, payment_expires_at)
        WHERE status='payment_pending' AND payment_status='pending'
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_id_unique
        ON payments (transaction_id)
        WHERE transaction_id IS NOT NULL
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_refund_id_unique
        ON payments (refund_id)
        WHERE refund_id IS NOT NULL
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_deposit_refund_id_unique
        ON payments (reliability_deposit_refund_id)
        WHERE reliability_deposit_refund_id IS NOT NULL
      `);
    };

    if (client === pool) {
      schemaReady = run();
      return schemaReady;
    }

    return run();
  }

  return schemaReady;
}

function normalizeFailedStatus(orderStatus) {
  return orderStatus === "EXPIRED" ? "expired" : "failed";
}

function serializePaymentMethod(paymentMethod) {
  if (!paymentMethod) return null;
  return typeof paymentMethod === "string"
    ? paymentMethod
    : JSON.stringify(paymentMethod);
}

function getWebhookIdempotencyHeader(headers) {
  const key =
    headers?.["x-idempotency-key"] ||
    headers?.["x-idempotency-header"] ||
    headers?.["cf-event-id"] ||
    headers?.["x-cf-event-id"];

  return Array.isArray(key) ? key[0] : key;
}

function getBodyEventId(body) {
  const data = body?.data || {};
  const orderId = data.order_id || data.order?.order_id || data.payment?.order_id;
  const orderStatus =
    data.order_status ||
    data.payment_status ||
    data.payment?.payment_status;
  const refundId = data.refund?.refund_id;
  const refundStatus = data.refund?.refund_status;

  return (
    body?.event_id ||
    body?.cf_event_id ||
    data.event_id ||
    data.cf_event_id ||
    data.payment_details?.cf_payment_id ||
    data.payment?.cf_payment_id ||
    (refundId && `${refundId}:${refundStatus || "unknown"}`) ||
    (orderId && `${orderId}:${orderStatus || "unknown"}`)
  );
}

function getWebhookIdempotencyKey(headers, rawBody, body) {
  const explicitKey = getWebhookIdempotencyHeader(headers);
  const eventId = getBodyEventId(body);

  if (explicitKey) return String(explicitKey);
  if (eventId) return String(eventId);

  return crypto.createHash("sha256").update(toRawBody(rawBody)).digest("hex");
}

function getWebhookEventFields(body) {
  const data = body?.data || {};
  const orderId = data.order_id || data.order?.order_id || data.payment?.order_id;
  const paymentStatus =
    data.order_status ||
    data.payment_status ||
    data.payment?.payment_status;
  const refundId = data.refund?.refund_id;

  return {
    eventType: body?.type || body?.event_type || data.type || null,
    orderId: orderId || null,
    cfPaymentId:
      data.payment_details?.cf_payment_id ||
      data.payment?.cf_payment_id ||
      null,
    refundId: refundId || null,
    status: paymentStatus || data.refund?.refund_status || null,
  };
}

async function wasWebhookProcessed(idempotencyKey) {
  if (!idempotencyKey) return false;
  return Boolean(await redis.get(`cashfree:webhook:${idempotencyKey}`));
}

async function reserveWebhookProcessing(idempotencyKey) {
  if (!idempotencyKey) return true;

  const result = await redis.set(
    `cashfree:webhook-lock:${idempotencyKey}`,
    "1",
    {
      EX: WEBHOOK_PROCESSING_LOCK_TTL_SECONDS,
      NX: true,
    }
  );

  return result === "OK";
}

async function markWebhookProcessedInRedis(idempotencyKey) {
  if (!idempotencyKey) return;

  await redis.setEx(
    `cashfree:webhook:${idempotencyKey}`,
    WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
    "1"
  );
}

async function releaseWebhookProcessing(idempotencyKey) {
  if (!idempotencyKey) return;
  await redis.del(`cashfree:webhook-lock:${idempotencyKey}`);
}

async function reserveWebhookEvent(client, event) {
  const inserted = await client.query(
    `
    INSERT INTO cashfree_webhook_events (
      idempotency_key,
      event_type,
      order_id,
      cf_payment_id,
      refund_id,
      payload,
      payload_hash,
      signature,
      webhook_timestamp
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      event.idempotencyKey,
      event.eventType,
      event.orderId,
      event.cfPaymentId,
      event.refundId,
      JSON.stringify(event.body),
      event.payloadHash,
      event.signature || null,
      event.timestamp || null,
    ]
  );

  if (inserted.rows.length) return { shouldProcess: true, event: inserted.rows[0] };

  const existing = await client.query(
    `
    SELECT *
    FROM cashfree_webhook_events
    WHERE idempotency_key=$1
    FOR UPDATE
    `,
    [event.idempotencyKey]
  );

  const row = existing.rows[0];
  if (!row || row.status === "processed") {
    return { shouldProcess: false, event: row || null };
  }

  await client.query(
    `
    UPDATE cashfree_webhook_events
    SET status='processing',
        attempts=attempts + 1,
        received_at=NOW(),
        failure_reason=NULL
    WHERE idempotency_key=$1
    `,
    [event.idempotencyKey]
  );

  return { shouldProcess: true, event: row };
}

async function markWebhookEventProcessed(client, idempotencyKey) {
  await client.query(
    `
    UPDATE cashfree_webhook_events
    SET status='processed',
        processed_at=NOW(),
        failure_reason=NULL
    WHERE idempotency_key=$1
    `,
    [idempotencyKey]
  );
}

async function markWebhookEventFailed(event, err) {
  if (!event?.idempotencyKey) return;

  await ensurePaymentHardeningSchema();
  await pool.query(
    `
    INSERT INTO cashfree_webhook_events (
      idempotency_key,
      event_type,
      order_id,
      cf_payment_id,
      refund_id,
      status,
      payload,
      payload_hash,
      signature,
      webhook_timestamp,
      processed_at,
      failure_reason
    )
    VALUES ($1,$2,$3,$4,$5,'failed',$6::jsonb,$7,$8,$9,NOW(),$10)
    ON CONFLICT (idempotency_key)
    DO UPDATE SET status='failed',
                  attempts=cashfree_webhook_events.attempts + 1,
                  processed_at=NOW(),
                  failure_reason=EXCLUDED.failure_reason
    `,
    [
      event.idempotencyKey,
      event.eventType || null,
      event.orderId || null,
      event.cfPaymentId || null,
      event.refundId || null,
      JSON.stringify(event.body || {}),
      event.payloadHash,
      event.signature || null,
      event.timestamp || null,
      String(err?.message || err || "unknown failure").slice(0, 1000),
    ]
  );
}

async function restorePendingReservation(client, reservationId, paymentStatus) {
  const reservationResult = await client.query(
    `
    SELECT *
    FROM reservations
    WHERE id=$1
    FOR UPDATE
    `,
    [reservationId]
  );

  if (!reservationResult.rows.length) return null;

  const reservation = reservationResult.rows[0];

  if (
    reservation.status !== "payment_pending" ||
    reservation.payment_status !== "pending"
  ) {
    return null;
  }

  if (hasReservedStock(reservation)) {
    await client.query(
      `
      UPDATE food_listings
      SET remaining_quantity = remaining_quantity + $1,
          status = CASE
            WHEN pickup_end_time > NOW() AND status='completed' THEN 'active'
            ELSE status
          END
      WHERE id=$2
      `,
      [reservation.quantity_reserved, reservation.listing_id]
    );
  }

  await client.query(
    `
    UPDATE payments
    SET reservation_id=NULL,
        status=$2,
        gateway_status=$2,
        reconciliation_status='terminal',
        last_reconciled_at=NOW(),
        updated_at=NOW()
    WHERE reservation_id=$1
    AND status='pending'
    `,
    [reservationId, paymentStatus]
  );

  await client.query(
    `
    DELETE FROM reservations
    WHERE id=$1
    AND status='payment_pending'
    AND payment_status='pending'
    `,
    [reservationId]
  );

  logger.info("Pending reservation restored after payment terminal state", {
    reservationId,
    listingId: reservation.listing_id,
    paymentStatus,
  });

  return reservation.listing_id;
}

async function activatePendingReservation(client, reservation) {
  const context = parsePaymentContext(reservation.payment_context);

  if (hasReservedStock(reservation)) {
    const activated = await client.query(
      `
      UPDATE reservations
      SET payment_status='paid',
          status='reserved',
          payment_context=COALESCE(payment_context, '{}'::jsonb) || $2::jsonb
      WHERE id=$1
      AND status='payment_pending'
      AND payment_status='pending'
      RETURNING *
      `,
      [
        reservation.id,
        JSON.stringify({ activated_at: new Date().toISOString() }),
      ]
    );

    return activated.rowCount > 0 ? activated.rows[0] : null;
  }

  const listingResult = await client.query(
    `
    SELECT *
    FROM food_listings
    WHERE id=$1
    FOR UPDATE
    `,
    [reservation.listing_id]
  );

  const listing = listingResult.rows[0];
  if (!listing) {
    throw new Error("Listing not found for paid reservation activation");
  }

  if (String(listing.status || "active") !== "active") {
    throw new Error("Listing no longer available for paid reservation activation");
  }

  if (new Date(listing.pickup_end_time).getTime() <= Date.now()) {
    throw new Error("Pickup window ended before payment activation");
  }

  if (Number(listing.remaining_quantity) < Number(reservation.quantity_reserved)) {
    throw new Error("Insufficient inventory for paid reservation activation");
  }

  const duplicateReservation = await client.query(
    `
    SELECT id
    FROM reservations
    WHERE user_id=$1
    AND listing_id=$2
    AND id <> $3
    AND (
      status IN ('reserved', 'picked_up', 'completed')
      OR task_status IN ('assigned', 'in_progress', 'picked_from_provider', 'delivered')
      OR (
        status='cancelled'
        AND COALESCE(payment_status, '') IN (
          'paid',
          'not_required',
          'refund_pending',
          'refunded',
          'refund_failed'
        )
      )
    )
    LIMIT 1
    `,
    [reservation.user_id, reservation.listing_id, reservation.id]
  );

  if (duplicateReservation.rows.length) {
    throw new Error("User already has reservation for this listing");
  }

  if (context.source === "ngo_request_accept" && context.request_id) {
    const requestResult = await client.query(
      `
      SELECT *
      FROM ngo_requests
      WHERE id=$1
      AND listing_id=$2
      FOR UPDATE
      `,
      [context.request_id, reservation.listing_id]
    );

    const request = requestResult.rows[0];
    if (!request || request.status !== "pending") {
      throw new Error("NGO request no longer available for paid reservation activation");
    }
  }

  const stockUpdate = await client.query(
    context.source === "ngo_request_accept"
      ? `
        UPDATE food_listings
        SET remaining_quantity = remaining_quantity - $1,
            status = CASE
              WHEN remaining_quantity - $1 <= 0 THEN 'completed'
              ELSE status
            END
        WHERE id=$2
        AND remaining_quantity >= $1
        RETURNING remaining_quantity
        `
      : `
        UPDATE food_listings
        SET remaining_quantity = remaining_quantity - $1
        WHERE id=$2
        AND remaining_quantity >= $1
        RETURNING remaining_quantity
      `,
    [reservation.quantity_reserved, reservation.listing_id]
  );

  if (!stockUpdate.rows.length) {
    throw new Error("Inventory update failed during paid reservation activation");
  }

  if (context.source === "ngo_request_accept" && context.request_id) {
    await client.query(
      `
      UPDATE ngo_requests
      SET status='accepted', responded_at=NOW()
      WHERE id=$1
      `,
      [context.request_id]
    );

    await client.query(
      `
      UPDATE ngo_requests
      SET status='expired', responded_at=NOW()
      WHERE listing_id=$1
      AND id != $2
      AND status='pending'
      `,
      [reservation.listing_id, context.request_id]
    );
  }

  const activated = await client.query(
    `
    UPDATE reservations
    SET payment_status='paid',
        status='reserved',
        pickup_code=COALESCE(pickup_code, $2),
        receive_code=COALESCE(receive_code, $3),
        payment_context=COALESCE(payment_context, '{}'::jsonb) || $4::jsonb
    WHERE id=$1
    AND status='payment_pending'
    AND payment_status='pending'
    RETURNING *
    `,
    [
      reservation.id,
      generatePickupCode(),
      generatePickupCode(),
      JSON.stringify({ stock_reserved: true, activated_at: new Date().toISOString() }),
    ]
  );

  return activated.rowCount > 0 ? activated.rows[0] : null;
}

async function processPaidOrder(client, orderId, paymentDetails = {}, sideEffects) {
  const paymentResult = await client.query(
    `
    SELECT *
    FROM payments
    WHERE order_id=$1
    FOR UPDATE
    `,
    [orderId]
  );

  if (!paymentResult.rows.length) return;

  for (const payment of paymentResult.rows) {
    if (payment.status === "refunded") continue;

    const reservationResult = await client.query(
      `
      SELECT *
      FROM reservations
      WHERE id=$1
      FOR UPDATE
      `,
      [payment.reservation_id]
    );
    const reservation = reservationResult.rows[0];

    if (!reservation) continue;
    if (reservation.payment_status === "refunded") continue;

    if (
      reservation.status === "cancelled" ||
      refundedPaymentStates.has(payment.status) ||
      refundedPaymentStates.has(reservation.payment_status)
    ) {
      if (payment.status !== "refund_pending") {
        await client.query(
          `
          UPDATE payments
          SET status='refund_pending',
              refund_status='refund_pending',
              gateway_status='paid_after_cancellation',
              last_reconciled_at=NOW(),
              updated_at=NOW()
          WHERE id=$1
          AND status <> 'refunded'
          `,
          [payment.id]
        );
      }

      await client.query(
        `
        UPDATE reservations
        SET payment_status='refund_pending'
        WHERE id=$1
        AND payment_status NOT IN ('refunded', 'refund_failed')
        `,
        [payment.reservation_id]
      );

      sideEffects.refundReservationIds.push(payment.reservation_id);
      sideEffects.changedReservationIds.add(payment.reservation_id);
      continue;
    }

    if (payment.status === "paid" && reservation.payment_status === "paid") {
      continue;
    }

    await client.query(
      `
      UPDATE payments
      SET status='paid',
          gateway_status='PAID',
          payment_method=$1,
          transaction_id=COALESCE(transaction_id, $2),
          reconciliation_status='terminal',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$3
      `,
      [
        serializePaymentMethod(paymentDetails?.payment_method),
        paymentDetails?.cf_payment_id || null,
        payment.id,
      ]
    );

    let activated = null;
    try {
      activated = await activatePendingReservation(client, reservation);
    } catch (err) {
      logger.error("Paid reservation activation failed", {
        err,
        reservationId: payment.reservation_id,
        orderId,
      });

      await client.query(
        `
        UPDATE payments
        SET status='refund_pending',
            refund_status='refund_pending',
            reconciliation_status='activation_failed_refund_pending',
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        AND status <> 'refunded'
        `,
        [payment.id]
      );

      await client.query(
        `
        UPDATE reservations
        SET status='cancelled',
            payment_status='refund_pending'
        WHERE id=$1
        AND payment_status <> 'refunded'
        `,
        [payment.reservation_id]
      );

      sideEffects.refundReservationIds.push(payment.reservation_id);
      sideEffects.changedReservationIds.add(payment.reservation_id);
      continue;
    }

    if (activated) {
      sideEffects.changedReservationIds.add(payment.reservation_id);
      sideEffects.activatedReservationIds.add(payment.reservation_id);
      sideEffects.changedListingIds.add(reservation.listing_id);
      logger.info("Payment finalized reservation", {
        reservationId: payment.reservation_id,
        orderId,
        listingId: reservation.listing_id,
      });
    }
  }
}

async function processFailedOrder(client, orderId, orderStatus, sideEffects) {
  const paymentStatus = normalizeFailedStatus(orderStatus);
  const paymentResult = await client.query(
    `
    SELECT *
    FROM payments
    WHERE order_id=$1
    FOR UPDATE
    `,
    [orderId]
  );

  for (const payment of paymentResult.rows) {
    if (
      ["paid", "success", "refunded", "refund_pending"].includes(payment.status)
    ) continue;

    const restoredListingId = await restorePendingReservation(
      client,
      payment.reservation_id,
      paymentStatus
    );
    if (restoredListingId) {
      sideEffects.changedListingIds.add(restoredListingId);
    }
  }
}

async function processRefundEvent(client, refund, sideEffects) {
  const { refund_id, refund_status } = refund || {};
  if (!refund_id) return;

  const paymentResult = await client.query(
    `
    SELECT *
    FROM payments
    WHERE refund_id=$1 OR reliability_deposit_refund_id=$1
    FOR UPDATE
    `,
    [refund_id]
  );

  if (!paymentResult.rows.length) return;

  const payment = paymentResult.rows[0];
  const isDepositRefund = payment.reliability_deposit_refund_id === refund_id;

  if (isDepositRefund) {
    if (payment.reliability_deposit_status === "refunded") return;

    if (refund_status === "SUCCESS") {
      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refunded',
            reliability_deposit_refunded_at=NOW(),
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        `,
        [payment.id]
      );
      sideEffects.changedReservationIds.add(payment.reservation_id);
      return;
    }

    if (refund_status === "FAILED") {
      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refund_failed',
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        AND reliability_deposit_status <> 'refunded'
        `,
        [payment.id]
      );
      sideEffects.changedReservationIds.add(payment.reservation_id);
      return;
    }

    await client.query(
      `
      UPDATE payments
      SET reliability_deposit_status='refund_pending',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      AND reliability_deposit_status <> 'refunded'
      `,
      [payment.id]
    );
    sideEffects.changedReservationIds.add(payment.reservation_id);
    return;
  }

  if (
    payment.refund_status === "refunded" ||
    payment.status === "refunded"
  ) {
    return;
  }

  if (refund_status === "SUCCESS") {
    await client.query(
      `
      UPDATE payments
      SET status='refunded',
          refund_status='refunded',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      `,
      [payment.id]
    );

    await client.query(
      `UPDATE reservations SET payment_status='refunded' WHERE id=$1`,
      [payment.reservation_id]
    );
    sideEffects.changedReservationIds.add(payment.reservation_id);
    return;
  }

  if (refund_status === "FAILED") {
    await client.query(
      `
      UPDATE payments
      SET status='refund_failed',
          refund_status='refund_failed',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      `,
      [payment.id]
    );

    await client.query(
      `
      UPDATE reservations
      SET payment_status='refund_failed'
      WHERE id=$1
      AND payment_status <> 'refunded'
      `,
      [payment.reservation_id]
    );
    sideEffects.changedReservationIds.add(payment.reservation_id);
    return;
  }

  if (!refundedPaymentStates.has(payment.status)) {
    await client.query(
      `
      UPDATE payments
      SET status='refund_pending',
          refund_status='refund_pending',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      `,
      [payment.id]
    );

    await client.query(
      `
      UPDATE reservations
      SET payment_status='refund_pending'
      WHERE id=$1
      AND payment_status NOT IN ('refunded', 'refund_failed')
      `,
      [payment.reservation_id]
    );
    sideEffects.changedReservationIds.add(payment.reservation_id);
  }
}

function createSideEffects() {
  return {
    refundReservationIds: [],
    changedReservationIds: new Set(),
    activatedReservationIds: new Set(),
    changedListingIds: new Set(),
  };
}

async function publishSideEffects(sideEffects, action = "payment_changed") {
  await Promise.all([
    ...[...sideEffects.changedListingIds].map((listingId) =>
      publishListingUpdated(listingId, { action: "quantity_updated" })
    ),
    ...[...sideEffects.changedReservationIds].map(async (reservationId) => {
      const reservation = await getReservationSnapshot(reservationId);
      await Promise.all([
        publishReservationUpdated(reservationId, {
          action,
          reservation,
        }),
        publishPaymentUpdated(reservationId, {
          action,
          reservation,
        }),
        reservation?.pickup_type === "ngo" &&
        reservation?.status === "reserved" &&
        reservation?.task_status === "pending"
          ? publishTaskAvailabilityUpdated(reservationId, {
              action: "available",
              reservation,
            })
          : Promise.resolve(),
        reservation?.listing_id
          ? publishListingUpdated(reservation.listing_id, {
              action: "quantity_updated",
            })
          : Promise.resolve(),
        sideEffects.activatedReservationIds.has(reservationId) &&
        reservation?.provider_id
          ? notificationQueue
              .add("notify-user", {
                userId: reservation.provider_id,
                type: "reservation_created",
                title:
                  reservation.pickup_type === "ngo"
                    ? "New NGO Reservation"
                    : "New Reservation",
                message:
                  reservation.pickup_type === "ngo"
                    ? "An NGO reserved food for pickup."
                    : "A new reservation has been placed.",
                data: {
                  reservation_id: reservationId,
                  listing_id: reservation.listing_id,
                },
              })
              .catch((err) => {
                logger.warn("Provider paid reservation notification failed", {
                  err,
                  reservationId,
                  providerId: reservation.provider_id,
                });
              })
          : Promise.resolve(),
      ]);
    }),
  ]);

  try {
    await Promise.all(
      sideEffects.refundReservationIds.map((reservationId) =>
        refundQueue.add(
          "refund-payment",
          { reservationId },
          {
            jobId: `refund-${reservationId}`,
            attempts: 5,
            backoff: { type: "exponential", delay: 3000 },
            removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
            removeOnFail: { age: 14 * 24 * 60 * 60, count: 2000 },
          }
        )
      )
    );
  } catch (err) {
    logger.error("Failed to enqueue payment reconciliation refund", { err });
  }
}

async function processCashfreePayload(client, body, sideEffects) {
  const data = body?.data || {};
  const orderId = data.order_id || data.order?.order_id || data.payment?.order_id;

  if (orderId) {
    const orderStatus =
      data.order_status ||
      data.payment_status ||
      data.payment?.payment_status;
    const paymentDetails = data.payment_details || data.payment || {};

    if (paidStatuses.has(orderStatus)) {
      await processPaidOrder(client, orderId, paymentDetails, sideEffects);
    } else if (failedStatuses.has(orderStatus)) {
      await processFailedOrder(client, orderId, orderStatus, sideEffects);
    }
  }

  if (data.refund) {
    await processRefundEvent(client, data.refund, sideEffects);
  }
}

async function handleCashfreeWebhook({ headers, rawBody }) {
  const signature = getHeaderValue(headers, "x-webhook-signature");
  const timestamp = getHeaderValue(headers, "x-webhook-timestamp");
  const rawBuffer = toRawBody(rawBody);

  verifyCashfreeWebhookSignature({ rawBody: rawBuffer, signature, timestamp });
  logger.payment("Cashfree webhook signature verified", {
    hasSignature: Boolean(signature),
    hasTimestamp: Boolean(timestamp),
  });

  let body;
  try {
    body = JSON.parse(rawBodyToString(rawBuffer));
  } catch (err) {
    err.statusCode = 400;
    throw err;
  }

  const idempotencyKey = getWebhookIdempotencyKey(headers, rawBuffer, body);
  const payloadHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
  const fields = getWebhookEventFields(body);
  const eventRecord = {
    idempotencyKey,
    body,
    payloadHash,
    signature,
    timestamp,
    ...fields,
  };
  let processingReserved = false;
  const sideEffects = createSideEffects();
  const client = await pool.connect();

  try {
    if (await wasWebhookProcessed(idempotencyKey)) {
      return { duplicate: true };
    }

    processingReserved = await reserveWebhookProcessing(idempotencyKey);
    if (!processingReserved) {
      return { duplicate: true };
    }

    await client.query("BEGIN");
    await ensurePaymentHardeningSchema(client);

    const reservedEvent = await reserveWebhookEvent(client, eventRecord);

    if (!reservedEvent.shouldProcess) {
      await client.query("COMMIT");
      await markWebhookProcessedInRedis(idempotencyKey);
      return { duplicate: true };
    }

    await processCashfreePayload(client, body, sideEffects);
    await markWebhookEventProcessed(client, idempotencyKey);
    await client.query("COMMIT");

    await markWebhookProcessedInRedis(idempotencyKey);
    await publishSideEffects(sideEffects);

    logger.payment("Cashfree webhook processed", {
      idempotencyKey,
      orderId: fields.orderId,
      refundId: fields.refundId,
      status: fields.status,
    });
    void recordOperationalEvent({
      category: "payment",
      severity: "info",
      eventName: "cashfree_webhook_processed",
      metadata: {
        idempotencyKey,
        orderId: fields.orderId,
        refundId: fields.refundId,
        status: fields.status,
      },
    });

    return { duplicate: false };
  } catch (err) {
    await client.query("ROLLBACK");
    void recordOperationalEvent({
      category: "payment",
      severity: "error",
      eventName: "cashfree_webhook_failed",
      metadata: {
        idempotencyKey,
        orderId: fields.orderId,
        refundId: fields.refundId,
        status: fields.status,
        message: err?.message,
      },
    });
    void recordAlert({
      alertKey: "payment:webhook_failure",
      category: "payment",
      severity: "error",
      message: "Cashfree webhook failure",
      metadata: { orderId: fields.orderId, message: err?.message },
    });
    await markWebhookEventFailed(eventRecord, err).catch((markErr) => {
      logger.warn("Cashfree webhook failure mark failed", { err: markErr });
    });
    throw err;
  } finally {
    if (processingReserved) {
      await releaseWebhookProcessing(idempotencyKey).catch((err) => {
        logger.warn("Cashfree webhook lock cleanup failed", { err });
      });
    }
    client.release();
  }
}

function normalizePaymentStatusFromGateway(order, payments = []) {
  const orderStatus = String(order?.order_status || "").toUpperCase();
  const successfulPayment = payments.find((payment) =>
    paidStatuses.has(String(payment.payment_status || "").toUpperCase())
  );

  if (successfulPayment || paidStatuses.has(orderStatus)) {
    return {
      status: "PAID",
      paymentDetails: successfulPayment || {},
    };
  }

  const failedPayment = payments.find((payment) =>
    failedStatuses.has(String(payment.payment_status || "").toUpperCase())
  );

  if (failedPayment) {
    return {
      status: String(failedPayment.payment_status || "FAILED").toUpperCase(),
      paymentDetails: failedPayment,
    };
  }

  if (failedStatuses.has(orderStatus)) {
    return {
      status: orderStatus,
      paymentDetails: {},
    };
  }

  return {
    status: orderStatus || "PENDING",
    paymentDetails: {},
  };
}

async function fetchCashfreeOrderState(orderId) {
  const [orderResponse, paymentsResponse] = await Promise.all([
    cashfree.PGFetchOrder(orderId),
    cashfree.PGOrderFetchPayments(orderId).catch((err) => {
      logger.warn("Cashfree payment fetch failed during reconciliation", {
        err,
        orderId,
      });
      return { data: [] };
    }),
  ]);

  const payments = Array.isArray(paymentsResponse.data) ? paymentsResponse.data : [];
  return normalizePaymentStatusFromGateway(orderResponse.data || {}, payments);
}

async function reconcileOrder({ orderId, source = "manual" }) {
  const gateway = await fetchCashfreeOrderState(orderId);
  const sideEffects = createSideEffects();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensurePaymentHardeningSchema(client);

    if (paidStatuses.has(gateway.status)) {
      await processPaidOrder(client, orderId, gateway.paymentDetails, sideEffects);
    } else if (failedStatuses.has(gateway.status)) {
      await processFailedOrder(client, orderId, gateway.status, sideEffects);
    } else {
      await client.query(
        `
        UPDATE payments
        SET gateway_status=$2,
            reconciliation_status='pending_gateway',
            reconciliation_attempts=COALESCE(reconciliation_attempts, 0) + 1,
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE order_id=$1
        AND status='pending'
        `,
        [orderId, gateway.status]
      );
    }

    await client.query("COMMIT");
    await publishSideEffects(sideEffects, "payment_reconciled");

    logger.payment("Payment order reconciled", {
      orderId,
      source,
      gatewayStatus: gateway.status,
      changedReservations: sideEffects.changedReservationIds.size,
    });
    void recordOperationalEvent({
      category: "payment",
      severity: "info",
      eventName: "payment_order_reconciled",
      metadata: {
        orderId,
        source,
        gatewayStatus: gateway.status,
        changedReservations: sideEffects.changedReservationIds.size,
      },
    });

    return {
      orderId,
      gatewayStatus: gateway.status,
      changedReservations: sideEffects.changedReservationIds.size,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Payment order reconciliation failed", { err, orderId, source });
    void recordAlert({
      alertKey: "payment:reconciliation_failure",
      category: "payment",
      severity: "error",
      message: "Payment reconciliation failed",
      metadata: { orderId, source, message: err?.message },
    });
    throw err;
  } finally {
    client.release();
  }
}

async function reconcileStalePaymentSessions(options = {}) {
  const {
    reservationIds = null,
    limit = PAYMENT_RECONCILIATION_LIMIT,
  } = options;

  await ensurePaymentHardeningSchema();

  const client = await pool.connect();
  let rows = [];

  try {
    await client.query("BEGIN");

    if (Array.isArray(reservationIds) && reservationIds.length > 0) {
      const result = await client.query(
        `
        SELECT p.order_id
        FROM reservations r
        JOIN payments p ON p.reservation_id=r.id
        WHERE r.id = ANY($1::uuid[])
        AND r.status='payment_pending'
        AND r.payment_status='pending'
        AND p.status='pending'
        FOR UPDATE OF r SKIP LOCKED
        `,
        [reservationIds]
      );
      rows = result.rows;
    } else {
      const result = await client.query(
        `
        SELECT p.order_id
        FROM reservations r
        JOIN payments p ON p.reservation_id=r.id
        WHERE r.status='payment_pending'
        AND r.payment_status='pending'
        AND p.status='pending'
        AND COALESCE(r.payment_expires_at, r.reserved_at + INTERVAL '10 minutes') <= NOW()
        ORDER BY p.order_id
        LIMIT $1
        FOR UPDATE OF r SKIP LOCKED
        `,
        [limit]
      );
      rows = result.rows;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const results = [];
  const orderIds = [...new Set(rows.map((row) => row.order_id).filter(Boolean))];
  for (const orderId of orderIds) {
    try {
      results.push(await reconcileOrder({ orderId, source: "stale_cleanup" }));
    } catch (err) {
      logger.error("Stale payment reconciliation item failed", {
        err,
        orderId,
      });
    }
  }

  return results;
}

module.exports = {
  ensurePaymentHardeningSchema,
  handleCashfreeWebhook,
  reconcileOrder,
  reconcileStalePaymentSessions,
  restorePendingReservation,
  verifyCashfreeWebhookSignature,
};
