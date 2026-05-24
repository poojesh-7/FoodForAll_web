const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { jobOptions, queueOptions } = require("../shared/utils/queueOptions");
const { registerQueue } = require("../shared/utils/queueRuntime");

const refundQueue = registerQueue(new Queue(
  "refund-queue",
  queueOptions(connection, {
    defaultJobOptions: jobOptions("critical"),
  })
));

module.exports = refundQueue;
