const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const operationalCleanupQueue = new Queue(
  "operational-cleanup-queue",
  queueOptions(connection, {
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: { age: 24 * 60 * 60, count: 100 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 100 },
    },
  })
);

module.exports = operationalCleanupQueue;
