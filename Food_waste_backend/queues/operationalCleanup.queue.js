const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { jobOptions, queueOptions } = require("../shared/utils/queueOptions");
const { registerQueue } = require("../shared/utils/queueRuntime");

const operationalCleanupQueue = registerQueue(new Queue(
  "operational-cleanup-queue",
  queueOptions(connection, {
    defaultJobOptions: jobOptions("operational"),
  })
));

module.exports = operationalCleanupQueue;
