const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");

const redis = require("../shared/config/redis");
const pool = require("../shared/config/db");
const notificationQueue = require("../queues/notification.queue");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const {
  publishListingUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
  publishVolunteerUpdated,
} = require("../shared/services/realtime.service");
const { applyPenalty } = require("../shared/services/penalty.service");
const { restoreListingStock } = require("../shared/services/inventory.service");

/*
Socket publisher
*/
async function publishSocketEvent(room, event, data) {
  await redis.publish(
    "socket_events",
    JSON.stringify({ room, event, data })
  );
}

async function penalizeVolunteer(client, volunteerId, reservationId, reason) {
  await client.query(
    `
    INSERT INTO volunteer_stats (volunteer_id)
    VALUES ($1)
    ON CONFLICT (volunteer_id) DO NOTHING
    `,
    [volunteerId]
  );

  await client.query(
    `
    UPDATE volunteer_stats
    SET total_timeouts = total_timeouts + 1
    WHERE volunteer_id=$1
    `,
    [volunteerId]
  );

  await applyPenalty({
    client,
    userId: volunteerId,
    role: "volunteer",
    reservationId,
    reason,
  });
}

/*
🔥 BullMQ Worker
*/
const pickupTimeoutWorker = new Worker(
  "pickup-queue",
  withWorkerBoundary("pickup-queue", async (job) => {
    const { reservationId } = job.data;

    logger.info("Pickup timeout triggered", { reservationId });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const reservation = await client.query(
        `
        SELECT id, listing_id, assigned_volunteer_id,
               quantity_reserved, task_status, status
        FROM reservations
        WHERE id=$1
        FOR UPDATE
        `,
        [reservationId]
      );

      if (!reservation.rows.length) {
        await client.query("ROLLBACK");
        return;
      }

      const r = reservation.rows[0];

      if (!r.assigned_volunteer_id) {
        await client.query("ROLLBACK");
        return;
      }

      if (r.task_status !== "in_progress" || r.status !== "reserved") {
        await client.query("ROLLBACK");
        return;
      }

      /*
      Return quantity
      */
      await restoreListingStock(client, {
        listingId: r.listing_id,
        quantity: r.quantity_reserved,
      });
      logger.info("Inventory restored after pickup timeout", {
        reservationId,
        listingId: r.listing_id,
        quantity: r.quantity_reserved,
      });

      /*
      Mark failed
      */
      await client.query(
        `
        UPDATE reservations
        SET status='expired',
            task_status='failed'
        WHERE id=$1
        `,
        [reservationId]
      );

      /*
      Penalize volunteer
      */
      await penalizeVolunteer(
        client,
        r.assigned_volunteer_id,
        reservationId,
        "Volunteer failed to reach provider"
      );

      await client.query("COMMIT");
      await Promise.all([
        publishReservationUpdated(reservationId, { action: "expired" }),
        publishVolunteerUpdated(reservationId, { action: "pickup_timeout" }),
        publishTaskAvailabilityUpdated(reservationId, { action: "unavailable" }),
        publishListingUpdated(r.listing_id, { action: "quantity_updated" }),
      ]);

      /*
      Notifications
      */

      await notificationQueue.add("notify-user", {
        userId: r.assigned_volunteer_id,
        type: "task_failed",
        title: "Task Cancelled",
        message: "Pickup task expired because you did not reach the provider.",
      });

      await publishSocketEvent(
        `user:${r.assigned_volunteer_id}`,
        "task:failed",
        { reservation_id: reservationId }
      );

      logger.info("Pickup timeout handled", { reservationId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err; // 🔥 retry enabled
    } finally {
      client.release();
    }
  }),
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

registerWorkerEvents(pickupTimeoutWorker, "pickup-queue");
