const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { jobOptions, queueOptions } = require("../shared/utils/queueOptions");
const { registerQueue } = require("../shared/utils/queueRuntime");

const deadLetterQueue = registerQueue(new Queue(
  "dead-letter-queue",
  queueOptions(connection, {
    defaultJobOptions: jobOptions("deadLetter"),
  })
));

module.exports = deadLetterQueue;
