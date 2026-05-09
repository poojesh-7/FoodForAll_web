const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");

console.log("Payment Timeout Worker Started");

new Worker(
  "payment-queue",
  async (job) => {
    const { reservationIds } = job.data;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const reservationId of reservationIds) {
        const reservationResult = await client.query(
          `
          SELECT *
          FROM reservations
          WHERE id=$1
          FOR UPDATE
          `,
          [reservationId]
        );

        if (!reservationResult.rows.length) continue;

        const reservation = reservationResult.rows[0];

        if (
          reservation.status !== "payment_pending" ||
          reservation.payment_status !== "pending"
        ) {
          continue;
        }

        const paymentResult = await client.query(
          `
          SELECT *
          FROM payments
          WHERE reservation_id=$1
          FOR UPDATE
          `,
          [reservationId]
        );

        if (
          paymentResult.rows.some((payment) =>
            ["paid", "success", "refunded"].includes(payment.status)
          )
        ) {
          continue;
        }

        await client.query(
          `
          UPDATE reservations
          SET status='cancelled',
              payment_status='expired'
          WHERE id=$1
          `,
          [reservationId]
        );

        await client.query(
          `
          UPDATE payments
          SET status='expired',
              updated_at=NOW()
          WHERE reservation_id=$1
          AND status='pending'
          `,
          [reservationId]
        );

        await client.query(
          `
          UPDATE food_listings
          SET remaining_quantity = remaining_quantity + $1
          WHERE id=$2
          `,
          [reservation.quantity_reserved, reservation.listing_id]
        );

        console.log("Payment timeout expired reservation:", reservationId);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
  { connection }
);
