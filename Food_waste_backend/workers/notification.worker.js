const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");

const { notifyUser } = require("../shared/services/notification.service");

const notificationWorker = new Worker(
  "notification-queue",
  withWorkerBoundary("notification-queue", async (job) => {
    const { userId, type, title, message, data } = job.data;
    const idempotencyKey =
      job.data.idempotencyKey ||
      job.data.idempotency_key ||
      (job.id ? `notification-queue:${job.id}:${job.timestamp || "unknown"}` : null);

    await notifyUser(userId, type, title, message, data, { idempotencyKey });
  }),
  workerOptions(connection)
);

registerWorkerEvents(notificationWorker, "notification-queue");
