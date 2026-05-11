const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");

const redis = require("../shared/config/redis");
const pool = require("../shared/config/db");
const notificationQueue = require("../queues/notification.queue");
const {
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
  publishVolunteerUpdated,
} = require("../shared/services/realtime.service");


/*
Socket publisher (unchanged)
*/
async function publishSocketEvent(room, event, data) {
  await redis.publish(
    "socket_events",
    JSON.stringify({ room, event, data })
  );
}

/*
Volunteer penalty logic (unchanged)
*/
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

  await client.query(
    `
    INSERT INTO penalties (user_id,reservation_id,reason)
    VALUES ($1,$2,$3)
    `,
    [volunteerId, reservationId, reason]
  );

  const penalty = await client.query(
    `
    UPDATE users
    SET penalty_count = penalty_count + 1
    WHERE id=$1
    RETURNING penalty_count
    `,
    [volunteerId]
  );

  if (penalty.rows[0].penalty_count >= 5) {
    await client.query(
      `
      UPDATE users
      SET banned_until = NOW() + INTERVAL '24 hours'
      WHERE id=$1
      `,
      [volunteerId]
    );
  }
}

/*
🔥 BullMQ Worker
*/
new Worker(
  "delivery-queue",
  async (job) => {
    const { reservationId } = job.data;

    console.log("⏱ Delivery timeout triggered:", reservationId);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const reservation = await client.query(
        `
        SELECT id, assigned_volunteer_id, task_status, status
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

      if (
        r.task_status !== "picked_from_provider" ||
        r.status !== "reserved"
      ) {
        await client.query("ROLLBACK");
        return;
      }

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
        "Volunteer picked food but did not deliver"
      );

      await client.query("COMMIT");
      await Promise.all([
        publishReservationUpdated(reservationId, { action: "expired" }),
        publishVolunteerUpdated(reservationId, { action: "delivery_timeout" }),
        publishTaskAvailabilityUpdated(reservationId, { action: "unavailable" }),
      ]);

      /*
      Notifications
      */

      await notificationQueue.add("notify-user", {
        userId: r.assigned_volunteer_id,
        type: "delivery_failed",
        title: "Delivery Failed",
        message: "Food was picked but not delivered to the NGO.",
});

      await publishSocketEvent(
        `user:${r.assigned_volunteer_id}`,
        "task:failed",
        { reservation_id: reservationId }
      );

      console.log("⚠️ Volunteer failed delivery:", reservationId);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err; // 🔥 enables retry
    } finally {
      client.release();
    }
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
