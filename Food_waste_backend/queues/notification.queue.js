const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { jobOptions, queueOptions } = require("../shared/utils/queueOptions");
const { registerQueue } = require("../shared/utils/queueRuntime");

const notificationQueue = registerQueue(new Queue(
  "notification-queue",
  queueOptions(connection, {
    defaultJobOptions: jobOptions("notification"),
  })
));

module.exports = notificationQueue;
