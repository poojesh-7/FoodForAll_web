const pool = require("../shared/config/db");
const cashfree = require("../shared/config/cashfree");
const notificationQueue = require("../queues/notification.queue");
const refundQueue = require("../queues/refund.queue");
const redis = require("../shared/config/redis");
const crypto = require("crypto");
const logger = require("../shared/utils/logger");
const generatePickupCode = require("../utils/codeGenerator");
const {
  getReservationSnapshot,
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
} = require("../shared/services/realtime.service");
const {
  ensureReservationPaymentContextSchema,
  hasReservedStock,
  parsePaymentContext,
} = require("../shared/services/reservationPaymentContext.service");

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

  return reservation.listing_id;
}

async function activatePendingReservation(client, reservation) {
  const context = parsePaymentContext(reservation.payment_context);

  if (hasReservedStock(reservation)) {
    const activated = await client.query(
      `
      UPDATE reservations
      SET payment_status='paid',
          status='reserved'
      WHERE id=$1
      AND status='payment_pending'
      AND payment_status='pending'
      RETURNING *
      `,
      [reservation.id]
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
  const activatedReservationIds = new Set();
  const restoredListingIds = new Set();

  try {
    await client.query("BEGIN");
    await ensureReservationPaymentContextSchema(client);

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

            refundReservationIds.push(payment.reservation_id);
            changedReservationIds.add(payment.reservation_id);
            continue;
          }

          if (activated) {
            changedReservationIds.add(payment.reservation_id);
            activatedReservationIds.add(payment.reservation_id);
            restoredListingIds.add(reservation.listing_id);
          }
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

          const restoredListingId = await restorePendingReservation(
            client,
            payment.reservation_id,
            paymentStatus
          );
          if (restoredListingId) {
            restoredListingIds.add(restoredListingId);
          }
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

    await Promise.all([
      ...[...restoredListingIds].map((listingId) =>
        publishListingUpdated(listingId, { action: "quantity_updated" })
      ),
      ...[...changedReservationIds].map(async (reservationId) => {
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
          activatedReservationIds.has(reservationId) && reservation?.provider_id
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
