const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");

const notificationQueue = require("../queues/notification.queue");

console.log("🚀 Starting expiry worker...");
new Worker(
  "expiry-queue",
  async (job) => {
    const { listingId } = job.data;

    console.log("⏰ Processing expiry for listing:", listingId);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      /*
      1️⃣ Expire listing
      */
      const listingResult = await client.query(
        `
        UPDATE food_listings
        SET status='expired'
        WHERE id=$1 AND status IN ('active', 'completed')
        RETURNING id, provider_id
        `,
        [listingId]
      );

      if (!listingResult.rows.length) {
        await client.query("ROLLBACK");
        return;
      }

      const providerId = listingResult.rows[0].provider_id;

      /*
      2️⃣ Fetch reservations
      */
      const reservations = await client.query(
        `
        SELECT id,user_id,quantity_reserved,pickup_type,assigned_volunteer_id
        FROM reservations
        WHERE listing_id=$1
        AND status='reserved'
        AND task_status IN ('pending','self_pickup')
        FOR UPDATE
        `,
        [listingId]
      );

      /*
      3️⃣ Return quantity
      */
      const totalReturned = reservations.rows.reduce(
        (sum, r) => sum + r.quantity_reserved,
        0
      );

      if (totalReturned > 0) {
        await client.query(
          `
          UPDATE food_listings
          SET remaining_quantity = remaining_quantity + $1
          WHERE id=$2
          `,
          [totalReturned, listingId]
        );
      }

      /*
      4️⃣ Expire reservations
      */
      const expired = await client.query(
        `
        UPDATE reservations
        SET status='expired',
            task_status='expired'
        WHERE listing_id=$1
        AND status='reserved'
        AND task_status IN ('pending','self_pickup')
        RETURNING id,user_id,pickup_type,assigned_volunteer_id
        `,
        [listingId]
      );

      /*
      5️⃣ NGO penalty
      */
      const ngoUsers = expired.rows
        .filter((r) => r.pickup_type === "ngo" && !r.assigned_volunteer_id)
        .map((r) => r.user_id);

      if (ngoUsers.length) {
        await client.query(
          `UPDATE users SET penalty_count = penalty_count + 1 WHERE id = ANY($1)`,
          [ngoUsers]
        );

        await client.query(
          `
          UPDATE users
          SET banned_until = NOW() + INTERVAL '24 hours'
          WHERE id = ANY($1)
          AND penalty_count % 3 = 0
          `,
          [ngoUsers]
        );
      }

      /*
      6️⃣ USER penalty (self pickup)
      */
      const normalUsers = expired.rows
        .filter((r) => r.pickup_type === "self")
        .map((r) => r.user_id);

      if (normalUsers.length) {
        await client.query(
          `UPDATE users SET penalty_count = penalty_count + 1 WHERE id = ANY($1)`,
          [normalUsers]
        );

        await client.query(
          `
          UPDATE users
          SET banned_until = NOW() + INTERVAL '1 hour'
          WHERE id = ANY($1)
          AND penalty_count % 3 = 0
          `,
          [normalUsers]
        );
      }

      /*
      7️⃣ Penalty logs
      */
     await client.query(
       `
       INSERT INTO penalties (user_id,reservation_id,reason)
        SELECT user_id,id,'Food not picked up before pickup window ended'
        FROM reservations
        WHERE listing_id=$1
        AND task_status='expired'
        `,
        [listingId]
      );
      
      /*
      7️⃣ update ngo requests
      */
      await client.query(
        `
        UPDATE ngo_requests
        SET status='expired'
        WHERE listing_id=$1
        AND status='pending'
        `,
        [listingId]
      );

      await client.query("COMMIT");

      /*
      🔔 Notify provider
      */
      await notificationQueue.add("notify-user", {
        userId: providerId,
        type: "listing_expired",
        title: "Listing Expired",
        message: "Your food listing has expired.",
      });

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Expiry worker error:", err);
      throw err;
    } finally {
      client.release();
    }
  },
  { connection }
);