const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const Cashfree = require("../shared/config/cashfree");

console.log("💸 Refund Worker Started");

new Worker(
  "refund-queue",
  async (job) => {
    const { reservationId } = job.data;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const paymentRes = await client.query(
        `SELECT * FROM payments WHERE reservation_id=$1 FOR UPDATE`,
        [reservationId]
      );

      if (!paymentRes.rows.length) {
        await client.query("ROLLBACK");
        return;
      }

      const payment = paymentRes.rows[0];

      /*
      🛑 IDEMPOTENCY
      */
      if (
        payment.refund_status === "processing" ||
        payment.refund_status === "refunded"
      ) {
        await client.query("ROLLBACK");
        return;
      }

      if (payment.status !== "success") {
        await client.query("ROLLBACK");
        return;
      }

      /*
      💸 CALL CASHFREE REFUND
      */
      const refundId = `refund_${Date.now()}`;

      const response = await Cashfree.PGRefund("2023-08-01", {
        refund_id: refundId,
        order_id: payment.order_id,
        refund_amount: payment.amount,
        refund_note: "Reservation cancelled",
      });

      console.log("Refund initiated:", response.data);

      /*
      🔄 MARK AS PROCESSING (NOT SUCCESS YET)
      */
      await client.query(
        `
        UPDATE payments
        SET refund_status='processing',
            refund_id=$1
        WHERE id=$2
        `,
        [refundId, payment.id]
      );

      await client.query("COMMIT");

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Refund worker error:", err.message);
      throw err;
    } finally {
      client.release();
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