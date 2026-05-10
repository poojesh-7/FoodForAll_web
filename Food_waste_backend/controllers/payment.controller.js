const pool = require("../shared/config/db");
const cashfree = require("../shared/config/cashfree");
const refundQueue = require("../queues/refund.queue");
const redis = require("../shared/config/redis");
const {
  getReservationSnapshot,
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
} = require("../shared/services/realtime.service");

const paidStatuses = new Set(["PAID", "SUCCESS"]);
const failedStatuses = new Set(["FAILED", "EXPIRED", "CANCELLED", "USER_DROPPED"]);
const refundedPaymentStates = new Set(["refund_pending", "refunded"]);
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

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

function getWebhookIdempotencyKey(req) {
  const key =
    req.headers["x-idempotency-key"] ||
    req.headers["x-idempotency-header"];

  return Array.isArray(key) ? key[0] : key;
}

async function wasWebhookProcessed(idempotencyKey) {
  if (!idempotencyKey) return false;
  return Boolean(await redis.get(`cashfree:webhook:${idempotencyKey}`));
}

async function markWebhookProcessed(idempotencyKey) {
  if (!idempotencyKey) return;

  await redis.setEx(
    `cashfree:webhook:${idempotencyKey}`,
    WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
    "1"
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
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  const idempotencyKey = getWebhookIdempotencyKey(req);

  if (signature && timestamp && process.env.CASHFREE_SECRET_KEY) {
    try {
      cashfree.PGVerifyWebhookSignature(signature, rawBody, timestamp);
    } catch (err) {
      console.error("Invalid Cashfree webhook signature:", err.message);
      return res.sendStatus(200);
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("Missing Cashfree webhook signature headers");
    return res.sendStatus(200);
  } else {
    console.warn("DEV MODE: Skipping Cashfree webhook signature verification");
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error("Invalid Cashfree webhook JSON");
    return res.sendStatus(200);
  }

  try {
    if (await wasWebhookProcessed(idempotencyKey)) {
      return res.sendStatus(200);
    }
  } catch (err) {
    console.warn("Cashfree webhook idempotency lookup failed:", err.message);
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
    } catch (err) {
      console.warn("Cashfree webhook idempotency mark failed:", err.message);
    }

    try {
      for (const reservationId of refundReservationIds) {
        await refundQueue.add(
          "refund-payment",
          { reservationId },
          {
            jobId: `refund-${reservationId}`,
            attempts: 5,
          }
        );
      }
    } catch (err) {
      console.error("Failed to enqueue late-payment refund:", err);
    }

    return res.sendStatus(200);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Webhook DB error:", err);
    return res.sendStatus(200);
  } finally {
    client.release();
  }
};
