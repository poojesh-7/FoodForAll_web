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

    await notifyUser(userId, type, title, message, data);
  }),
  workerOptions(connection)
);

registerWorkerEvents(notificationWorker, "notification-queue");
