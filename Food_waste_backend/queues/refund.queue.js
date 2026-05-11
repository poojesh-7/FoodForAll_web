const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const refundQueue = new Queue(
  "refund-queue",
  queueOptions(connection, {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 2000 },
    },
  })
);

module.exports = refundQueue;
