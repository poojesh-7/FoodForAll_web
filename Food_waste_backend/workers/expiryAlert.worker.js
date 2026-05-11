const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");

const pool = require("../shared/config/db");
const notificationQueue = require("../queues/notification.queue");
const { findNearbyNGOs } = require("../services/geo.service");

const expiryAlertWorker = new Worker(
  "expiry-alert-queue",
  async (job) => {
    logger.info("Processing expiry alert", { listingId: job.data.listingId });
    const { listingId } = job.data;

    const listing = await pool.query(
      `SELECT id,title,latitude,longitude,is_free
       FROM food_listings
       WHERE id=$1 AND status='active'`,
      [listingId]
    );

    if (!listing.rows.length) return;

    const food = listing.rows[0];

    // No send alerts for paid food listings
    if (!food.is_free) {
      logger.info("Skipping paid listing expiry alert", { listingId });
      return;
    }

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

    logger.info("Expiry alert sent", { listingId });
  },
  workerOptions(connection, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
  })
);

registerWorkerEvents(expiryAlertWorker, "expiry-alert-queue");
