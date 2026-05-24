const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { jobOptions, queueOptions } = require("../shared/utils/queueOptions");
const { registerQueue } = require("../shared/utils/queueRuntime");

const pickupQueue = registerQueue(
  new Queue(
    "pickup-queue",
    queueOptions(connection, {
      defaultJobOptions: jobOptions("critical"),
    })
  )
);

module.exports = pickupQueue;
