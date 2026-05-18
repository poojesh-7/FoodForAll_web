const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const deadLetterQueue = new Queue(
  "dead-letter-queue",
  queueOptions(connection, {
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 10000 },
    },
  })
);

module.exports = deadLetterQueue;
