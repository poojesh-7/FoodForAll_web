const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const pool = require("../shared/config/db");

const { notifyUser } = require("../shared/services/notification.service");

const notificationWorker = new Worker(
  "notification-queue",
  withWorkerBoundary("notification-queue", async (job) => {
    const { userId, reservationId, type, title, message, data } = job.data;

    if (job.name === "payment-pending-reminder") {
      const result = await pool.query(
        `SELECT status, payment_status, payment_expires_at
         FROM reservations
         WHERE id=$1 AND user_id=$2`,
        [reservationId, userId]
      );
      const reservation = result.rows[0];
      const remainingMs = reservation?.payment_expires_at
        ? new Date(reservation.payment_expires_at).getTime() - Date.now()
        : 0;

      if (
        !reservation ||
        reservation.status !== "payment_pending" ||
        reservation.payment_status !== "pending" ||
        remainingMs <= 0 ||
        remainingMs > 3 * 60 * 1000
      ) {
        return;
      }
    }

    const idempotencyKey =
      job.data.idempotencyKey ||
      job.data.idempotency_key ||
      (job.id ? `notification-queue:${job.id}:${job.timestamp || "unknown"}` : null);

    await notifyUser(userId, type, title, message, data, { idempotencyKey });
  }),
  workerOptions(connection)
);

registerWorkerEvents(notificationWorker, "notification-queue");
