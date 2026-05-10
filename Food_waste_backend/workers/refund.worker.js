const { Worker } = require("bullmq");
const crypto = require("crypto");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const cashfree = require("../shared/config/cashfree");
const {
  publishPaymentUpdated,
  publishReservationUpdated,
} = require("../shared/services/realtime.service");

console.log("Refund Worker Started");

const FINAL_REFUND_STATES = new Set(["refunded"]);
const REFUNDABLE_PAYMENT_STATES = new Set([
  "paid",
  "success",
  "refund_pending",
  "refund_failed",
]);

function normalizeRefundStatus(status) {
  const normalized = String(status || "").toUpperCase();

  if (normalized === "SUCCESS") return "refunded";
  if (normalized === "FAILED" || normalized === "CANCELLED") {
    return "refund_failed";
  }

  return "refund_pending";
}

async function markRefundFailed(reservationId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `
      SELECT *
      FROM payments
      WHERE reservation_id=$1
      FOR UPDATE
      `,
      [reservationId]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");
      return;
    }

    const payment = paymentResult.rows[0];

    if (FINAL_REFUND_STATES.has(payment.status)) {
      await client.query("ROLLBACK");
      return;
    }

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
      [reservationId]
    );

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: "refund_failed" }),
      publishPaymentUpdated(reservationId, { action: "refund_failed" }),
    ]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function persistRefundStatus(reservationId, refundStatus) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `
      SELECT *
      FROM payments
      WHERE reservation_id=$1
      FOR UPDATE
      `,
      [reservationId]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");
      return;
    }

    const payment = paymentResult.rows[0];

    if (FINAL_REFUND_STATES.has(payment.status)) {
      await client.query("ROLLBACK");
      return;
    }

    if (refundStatus === "refunded") {
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
        `
        UPDATE reservations
        SET payment_status='refunded'
        WHERE id=$1
        `,
        [reservationId]
      );
    } else if (refundStatus === "refund_failed") {
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
        [reservationId]
      );
    } else {
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
        [reservationId]
      );
    }

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: refundStatus }),
      publishPaymentUpdated(reservationId, { action: refundStatus }),
    ]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function prepareRefund(reservationId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `
      SELECT
        p.*,
        r.status AS reservation_status,
        r.payment_status AS reservation_payment_status
      FROM payments p
      JOIN reservations r ON r.id=p.reservation_id
      WHERE p.reservation_id=$1
      FOR UPDATE
      `,
      [reservationId]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const payment = paymentResult.rows[0];

    if (
      payment.status === "refunded" ||
      payment.refund_status === "refunded" ||
      payment.reservation_payment_status === "refunded"
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    if (
      payment.reservation_status !== "cancelled" ||
      !REFUNDABLE_PAYMENT_STATES.has(payment.status)
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    const refundId = payment.refund_id || crypto.randomUUID();

    await client.query(
      `
      UPDATE payments
      SET status='refund_pending',
          refund_status='refund_pending',
          refund_id=$1,
          updated_at=NOW()
      WHERE id=$2
      `,
      [refundId, payment.id]
    );

    await client.query(
      `
      UPDATE reservations
      SET payment_status='refund_pending'
      WHERE id=$1
      AND payment_status NOT IN ('refunded', 'refund_failed')
      `,
      [reservationId]
    );

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: "refund_pending" }),
      publishPaymentUpdated(reservationId, { action: "refund_pending" }),
    ]);

    return {
      orderId: payment.order_id,
      refundId,
      amount: Number(payment.amount),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

new Worker(
  "refund-queue",
  async (job) => {
    const { reservationId } = job.data;
    const refund = await prepareRefund(reservationId);

    if (!refund) return;

    try {
      const response = await cashfree.PGOrderCreateRefund(
        refund.orderId,
        {
          refund_id: refund.refundId,
          refund_amount: refund.amount,
          refund_note: "Reservation cancelled before pickup cutoff",
        },
        undefined,
        refund.refundId
      );

      const refundStatus = normalizeRefundStatus(response.data?.refund_status);
      await persistRefundStatus(reservationId, refundStatus);
    } catch (err) {
      const attempts = job.opts.attempts || 5;
      const isLastAttempt = job.attemptsMade + 1 >= attempts;

      console.error("Refund worker error:", err.response?.data || err.message);

      if (isLastAttempt) {
        await markRefundFailed(reservationId);
      }

      throw err;
    }
  },
  {
    connection,
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
  }
);
