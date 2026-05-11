const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const paymentQueue = new Queue(
  "payment-queue",
  queueOptions(connection, {
    defaultJobOptions: {
      attempts: 5,
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
    },
  })
);

module.exports = paymentQueue;
