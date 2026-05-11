const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const expiryQueue = new Queue("expiry-queue", queueOptions(connection));

module.exports = expiryQueue;
