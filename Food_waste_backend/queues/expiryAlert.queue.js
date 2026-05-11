const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const expiryAlertQueue = new Queue("expiry-alert-queue", queueOptions(connection));

module.exports = expiryAlertQueue;
