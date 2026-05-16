const pool = require("../shared/config/db");
const cashfree = require("../shared/config/cashfree");
const refundQueue = require("../queues/refund.queue");
const redis = require("../shared/config/redis");
const crypto = require("crypto");
const logger = require("../shared/utils/logger");
const {
  getReservationSnapshot,
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
} = require("../shared/services/realtime.service");

const paidStatuses = new Set(["PAID", "SUCCESS"]);
const failedStatuses = new Set(["FAILED", "EXPIRED", "CANCELLED", "USER_DROPPED"]);
const refundedPaymentStates = new Set(["refund_pending", "refunded"]);
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
const WEBHOOK_PROCESSING_LOCK_TTL_SECONDS = 5 * 60;
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function toRawBody(body) {
  return Buffer.isBuffer(body) ? body.toString("utf8") : JSON.stringify(body || {});
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

function getHeaderValue(req, headerName) {
  const value = req.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}

function getWebhookIdempotencyHeader(req) {
  const key =
    req.headers["x-idempotency-key"] ||
    req.headers["x-idempotency-header"];

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
    data.payment?.cf_payment_id ||
    (refundId && `${refundId}:${refundStatus || "unknown"}`) ||
    (orderId && `${orderId}:${orderStatus || "unknown"}`)
  );
}

function getWebhookIdempotencyKey(req, rawBody, body) {
  const explicitKey = getWebhookIdempotencyHeader(req);
  const eventId = getBodyEventId(body);

  if (explicitKey) return String(explicitKey);
  if (eventId) return String(eventId);

  return crypto.createHash("sha256").update(rawBody).digest("hex");
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

async function markWebhookProcessed(idempotencyKey) {
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

  if (!reservationResult.rows.length) return;

  const reservation = reservationResult.rows[0];

  if (
    reservation.status !== "payment_pending" ||
    reservation.payment_status !== "pending"
  ) {
    return;
  }

  await client.query(
    `
    UPDATE reservations
    SET status='cancelled',
        payment_status=$2
    WHERE id=$1
    `,
    [reservationId, paymentStatus]
  );

  await client.query(
    `
    UPDATE food_listings
    SET remaining_quantity = remaining_quantity + $1
    WHERE id=$2
    `,
    [reservation.quantity_reserved, reservation.listing_id]
  );
}

exports.cashfreeWebhook = async (req, res) => {
  const rawBody = toRawBody(req.body);
  const signature = getHeaderValue(req, "x-webhook-signature");
  const timestamp = getHeaderValue(req, "x-webhook-timestamp");

  if (signature && timestamp && process.env.CASHFREE_SECRET_KEY) {
    if (process.env.NODE_ENV === "production" && !isFreshWebhookTimestamp(timestamp)) {
      logger.warn("Stale Cashfree webhook timestamp");
      return res.sendStatus(200);
    }

    try {
      cashfree.PGVerifyWebhookSignature(signature, rawBody, timestamp);
    } catch (err) {
      logger.warn("Invalid Cashfree webhook signature", { err });
      return res.sendStatus(200);
    }
  } else if (process.env.NODE_ENV === "production") {
    logger.warn("Missing Cashfree webhook signature headers");
    return res.sendStatus(200);
  } else {
    logger.warn("DEV MODE: Skipping Cashfree webhook signature verification");
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    logger.warn("Invalid Cashfree webhook JSON", { err });
    return res.sendStatus(200);
  }

  const idempotencyKey = getWebhookIdempotencyKey(req, rawBody, body);
  let processingReserved = false;

  try {
    if (await wasWebhookProcessed(idempotencyKey)) {
      return res.sendStatus(200);
    }

    processingReserved = await reserveWebhookProcessing(idempotencyKey);
    if (!processingReserved) {
      return res.sendStatus(200);
    }
  } catch (err) {
    logger.warn("Cashfree webhook idempotency guard failed", { err });
  }

  const data = body.data || {};
  const client = await pool.connect();
  const refundReservationIds = [];
  const changedReservationIds = new Set();

  try {
    await client.query("BEGIN");

    const orderId = data.order_id || data.order?.order_id || data.payment?.order_id;

    if (orderId) {
      const orderStatus =
        data.order_status ||
        data.payment_status ||
        data.payment?.payment_status;
      const paymentDetails = data.payment_details || data.payment || {};

      const paymentResult = await client.query(
        `
        SELECT *
        FROM payments
        WHERE order_id=$1
        FOR UPDATE
        `,
        [orderId]
      );

      if (!paymentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.sendStatus(200);
      }

      if (paidStatuses.has(orderStatus)) {
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

            refundReservationIds.push(payment.reservation_id);
            changedReservationIds.add(payment.reservation_id);
            continue;
          }

          if (payment.status === "paid" && reservation.payment_status === "paid") {
            continue;
          }

          await client.query(
            `
            UPDATE payments
            SET status='paid',
                payment_method=$1,
                transaction_id=$2,
                updated_at=NOW()
            WHERE id=$3
            `,
            [
              serializePaymentMethod(paymentDetails?.payment_method),
              paymentDetails?.cf_payment_id || null,
              payment.id,
            ]
          );

          await client.query(
            `
            UPDATE reservations
            SET payment_status='paid',
                status='reserved'
            WHERE id=$1
            AND status='payment_pending'
            AND payment_status='pending'
            `,
            [payment.reservation_id]
          );
          changedReservationIds.add(payment.reservation_id);
        }
      }

      if (failedStatuses.has(orderStatus)) {
        const paymentStatus = normalizeFailedStatus(orderStatus);

        for (const payment of paymentResult.rows) {
          if (
            ["paid", "success", "refunded", "refund_pending"].includes(
              payment.status
            )
          ) continue;

          await client.query(
            `
            UPDATE payments
            SET status=$1,
                updated_at=NOW()
            WHERE id=$2
            AND status='pending'
            `,
            [paymentStatus, payment.id]
          );

          await restorePendingReservation(
            client,
            payment.reservation_id,
            paymentStatus
          );
          changedReservationIds.add(payment.reservation_id);
        }
      }
    }

    if (data.refund) {
      const { refund_id, refund_status } = data.refund;

      const paymentResult = await client.query(
        `SELECT * FROM payments WHERE refund_id=$1 FOR UPDATE`,
        [refund_id]
      );

      if (!paymentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.sendStatus(200);
      }

      const payment = paymentResult.rows[0];

      if (
        payment.refund_status === "refunded" ||
        payment.status === "refunded"
      ) {
        await client.query("ROLLBACK");
        return res.sendStatus(200);
      }

      if (refund_status === "SUCCESS") {
        await client.query(
          `
          UPDATE payments
          SET status='refunded',
              refund_status='refunded',
              updated_at=NOW()
          WHERE id=$1
          `,
          [payment.id]
        );

        await client.query(
          `UPDATE reservations SET payment_status='refunded' WHERE id=$1`,
          [payment.reservation_id]
        );
        changedReservationIds.add(payment.reservation_id);
      }

      if (refund_status === "FAILED") {
        await client.query(
          `
          UPDATE payments
          SET status='refund_failed',
              refund_status='refund_failed',
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
        changedReservationIds.add(payment.reservation_id);
      }

      if (
        refund_status !== "SUCCESS" &&
        refund_status !== "FAILED" &&
        !refundedPaymentStates.has(payment.status)
      ) {
        await client.query(
          `
          UPDATE payments
          SET status='refund_pending',
              refund_status='refund_pending',
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
        changedReservationIds.add(payment.reservation_id);
      }
    }

    await client.query("COMMIT");

    await Promise.all(
      [...changedReservationIds].map(async (reservationId) => {
        const reservation = await getReservationSnapshot(reservationId);
        await Promise.all([
          publishReservationUpdated(reservationId, {
            action: "payment_changed",
            reservation,
          }),
          publishPaymentUpdated(reservationId, {
            action: "payment_changed",
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
        ]);
      })
    );

    try {
      await markWebhookProcessed(idempotencyKey);
      await releaseWebhookProcessing(idempotencyKey);
      processingReserved = false;
    } catch (err) {
      logger.warn("Cashfree webhook idempotency mark failed", { err });
    }

    try {
      for (const reservationId of refundReservationIds) {
        await refundQueue.add(
          "refund-payment",
          { reservationId },
          {
            jobId: `refund-${reservationId}`,
            attempts: 5,
            backoff: { type: "exponential", delay: 3000 },
            removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
            removeOnFail: { age: 14 * 24 * 60 * 60, count: 2000 },
          }
        );
      }
    } catch (err) {
      logger.error("Failed to enqueue late-payment refund", { err });
    }

    return res.sendStatus(200);
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Cashfree webhook database update failed", { err });
    return res.sendStatus(200);
  } finally {
    if (processingReserved) {
      try {
        await releaseWebhookProcessing(idempotencyKey);
      } catch (err) {
        logger.warn("Cashfree webhook lock cleanup failed", { err });
      }
    }
    client.release();
  }
};
