const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");

console.log("💳 Payment Timeout Worker Started");

new Worker(
  "payment-queue",
  async (job) => {
    const { reservationIds } = job.data;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const reservationId of reservationIds) {
        const res = await client.query(
          `
          SELECT *
          FROM reservations
          WHERE id=$1
          FOR UPDATE
          `,
          [reservationId]
        );

        if (!res.rows.length) continue;

        const r = res.rows[0];

        /*
        🛑 IDEMPOTENCY
        */
        if (r.payment_status === "paid") continue;
        if (r.status !== "reserved") continue;

        /*
        ❌ CANCEL RESERVATION
        */
        await client.query(
          `UPDATE reservations SET status='cancelled' WHERE id=$1`,
          [reservationId]
        );

        /*
        🔄 RESTORE STOCK
        */
        await client.query(
          `
          UPDATE food_listings
          SET remaining_quantity = remaining_quantity + $1
          WHERE id=$2
          `,
          [r.quantity_reserved, r.listing_id]
        );

        console.log("❌ Payment timeout cancelled:", reservationId);
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