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
const { retainReliabilityDeposit } = require("../shared/services/payment.service");
const {
  recordReservationLifecycleTrustEvents,
} = require("../shared/services/trustEnforcement.service");
const {
  lockReservationGraph,
  restoreReservationStockIfHeld,
} = require("../shared/services/reservationConsistency.service");

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

  logger.security("Volunteer pickup timeout recorded", {
    volunteerId,
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

      const { reservation: r } = await lockReservationGraph(client, reservationId, {
        lockPayments: false,
      });

      if (!r) {
        await client.query("ROLLBACK");
        return;
      }

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
      await restoreReservationStockIfHeld(client, r, {
        reason: "pickup_timeout",
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
      await recordReservationLifecycleTrustEvents({
        client,
        reservationId,
      });
      await retainReliabilityDeposit(client, reservationId, {
        reservation: r,
        terminalReason: "volunteer_pickup_failed",
      });

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
        data: {
          href: "/volunteer/tasks",
          reservation_id: reservationId,
        },
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
  workerOptions(connection)
);

registerWorkerEvents(pickupTimeoutWorker, "pickup-queue");
