const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { jobOptions, queueOptions } = require("../shared/utils/queueOptions");
const { registerQueue } = require("../shared/utils/queueRuntime");

const deliveryQueue = registerQueue(
  new Queue(
    "delivery-queue",
    queueOptions(connection, {
      defaultJobOptions: jobOptions("critical"),
    })
  )
);

module.exports = deliveryQueue;
