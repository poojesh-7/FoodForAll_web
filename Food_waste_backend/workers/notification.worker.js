const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const notificationQueue = require("../queues/notification.queue");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { jobOptions, workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const {
  processNotificationOutboxBatch,
} = require("../shared/services/notificationOutbox.service");

const { notifyUser } = require("../shared/services/notification.service");

notificationQueue
  .add(
    "notification-outbox-sweep",
    {},
    jobOptions("operational", {
      jobId: "notification-outbox-sweep",
      repeat: { every: Number(process.env.NOTIFICATION_OUTBOX_SWEEP_MS || 15000) },
      removeOnComplete: { age: 60 * 60, count: 100 },
      removeOnFail: { age: 24 * 60 * 60, count: 500 },
    })
  )
  .catch((err) => {
    logger.error("Notification outbox sweep scheduling failed", { err });
  });

const notificationWorker = new Worker(
  "notification-queue",
  withWorkerBoundary("notification-queue", async (job) => {
    if (job.name === "notification-outbox-sweep") {
      const summary = await processNotificationOutboxBatch();
      logger.info("Notification outbox sweep completed", {
        jobId: job.id,
        ...summary,
      });
      return;
    }

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
