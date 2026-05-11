const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const notificationQueue = new Queue(
  "notification-queue",
  queueOptions(connection, {
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
    },
  })
);

module.exports = notificationQueue;
