const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");

const notificationQueue = require("../queues/notification.queue");
const { applyPenalty } = require("../shared/services/penalty.service");
const { retainReliabilityDeposit } = require("../shared/services/payment.service");
const { restoreListingStock } = require("../shared/services/inventory.service");
const {
  publishListingUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
} = require("../shared/services/realtime.service");

logger.info("Expiry worker started");
const expiryWorker = new Worker(
  "expiry-queue",
  withWorkerBoundary("expiry-queue", async (job) => {
    const { listingId } = job.data;

    logger.info("Processing listing expiry", { listingId });

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
        SELECT r.id,r.user_id,r.quantity_reserved,r.pickup_type,r.assigned_volunteer_id,
               f.price
        FROM reservations r
        JOIN food_listings f ON f.id = r.listing_id
        WHERE r.listing_id=$1
        AND r.status='reserved'
        AND r.task_status IN ('pending','self_pickup')
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
        await restoreListingStock(client, {
          listingId,
          quantity: totalReturned,
          reactivateIfAvailable: false,
        });
        logger.info("Inventory restored during listing expiry", {
          listingId,
          quantity: totalReturned,
          reservationCount: reservations.rows.length,
        });
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

      const expiredById = new Map(expired.rows.map((reservation) => [reservation.id, reservation]));
      for (const reservation of reservations.rows) {
        if (!expiredById.has(reservation.id)) continue;

        if (reservation.pickup_type === "ngo" && reservation.assigned_volunteer_id) {
          continue;
        }

        const role = reservation.pickup_type === "ngo" ? "ngo" : "user";
        await applyPenalty({
          client,
          userId: reservation.user_id,
          role,
          reservationId: reservation.id,
          reason: "Food not picked up before pickup window ended",
          foodCost: Number(reservation.price || 0) * Number(reservation.quantity_reserved || 0),
        });
        await retainReliabilityDeposit(client, reservation.id, {
          reservation,
          terminalReason: "reservation_expired",
        });
      }
      
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
      await Promise.all([
        publishListingUpdated(listingId, { action: "expired" }),
        ...expired.rows.map((reservation) =>
          publishReservationUpdated(reservation.id, { action: "expired" })
        ),
        ...expired.rows.map((reservation) =>
          publishTaskAvailabilityUpdated(reservation.id, { action: "unavailable" })
        ),
      ]);

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
      logger.error("Expiry worker error", { err, listingId });
      throw err;
    } finally {
      client.release();
    }
  }),
  workerOptions(connection)
);

registerWorkerEvents(expiryWorker, "expiry-queue");
