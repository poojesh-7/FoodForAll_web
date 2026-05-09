const { Worker } = require("bullmq");
const crypto = require("crypto");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const cashfree = require("../shared/config/cashfree");

console.log("Refund Worker Started");

function normalizeRefundStatus(status) {
  if (status === "SUCCESS") return "refunded";
  if (status === "FAILED" || status === "CANCELLED") return "failed";
  return "processing";
}

async function persistRefundStatus(reservationId, refundStatus) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `SELECT * FROM payments WHERE reservation_id=$1 FOR UPDATE`,
      [reservationId]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");
      return;
    }

    const payment = paymentResult.rows[0];

    if (payment.refund_status === "refunded") {
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
        `UPDATE reservations SET payment_status='refunded' WHERE id=$1`,
        [reservationId]
      );
    } else {
      await client.query(
        `
        UPDATE payments
        SET refund_status=$1,
            updated_at=NOW()
        WHERE id=$2
        `,
        [refundStatus, payment.id]
      );
    }

    await client.query("COMMIT");
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
    const client = await pool.connect();

    let payment;
    let refundId;

    try {
      await client.query("BEGIN");

      const paymentResult = await client.query(
        `
        SELECT p.*, r.status AS reservation_status
        FROM payments p
        JOIN reservations r ON r.id=p.reservation_id
        WHERE p.reservation_id=$1
        FOR UPDATE
        `,
        [reservationId]
      );

      if (!paymentResult.rows.length) {
        await client.query("ROLLBACK");
        return;
      }

      payment = paymentResult.rows[0];

      if (payment.refund_status === "refunded" || payment.status === "refunded") {
        await client.query("ROLLBACK");
        return;
      }

      if (
        !["paid", "success"].includes(payment.status) ||
        payment.reservation_status !== "cancelled"
      ) {
        await client.query("ROLLBACK");
        return;
      }

      refundId = payment.refund_id || crypto.randomUUID();

      await client.query(
        `
        UPDATE payments
        SET refund_status='processing',
            refund_id=$1,
            updated_at=NOW()
        WHERE id=$2
        `,
        [refundId, payment.id]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    try {
      const response = await cashfree.PGOrderCreateRefund(
        payment.order_id,
        {
          refund_id: refundId,
          refund_amount: Number(payment.amount),
          refund_note: "Reservation cancelled",
        },
        undefined,
        refundId
      );

      const refundStatus = normalizeRefundStatus(response.data?.refund_status);
      await persistRefundStatus(reservationId, refundStatus);
    } catch (err) {
      console.error("Refund worker error:", err.response?.data || err.message);
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
