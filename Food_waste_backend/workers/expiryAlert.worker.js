const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");

const pool = require("../shared/config/db");
const notificationQueue = require("../queues/notification.queue");
const { findNearbyNGOs } = require("../services/geo.service");

new Worker(
  "expiry-alert-queue",
  async (job) => {
    console.log("🔔 Processing expiry alert for listing:", job.data.listingId);
    const { listingId } = job.data;

    const listing = await pool.query(
      `SELECT id,title,latitude,longitude
       FROM food_listings
       WHERE id=$1 AND status='active'`,
      [listingId]
    );

    if (!listing.rows.length) return;

    const food = listing.rows[0];

    const ngoIds = await findNearbyNGOs(
      food.longitude,
      food.latitude,
      5
    );

    if (!ngoIds.length) return;

    const ngoUsers = await pool.query(
      `
      SELECT user_id
      FROM ngos
      WHERE id = ANY($1)
      AND is_verified = true
      `,
      [ngoIds]
    );


    for (const ngo of ngoUsers.rows) {
      await notificationQueue.add("notify-user", {
        userId: ngo.user_id,
        type: "food_expiring",
        title: "Food Expiring Soon",
        message: `${food.title} will expire soon. Rescue it now!`,
      });
    }

    console.log("🚨 Expiry alert sent:", listingId);
  },
  {
    connection,
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  }
);