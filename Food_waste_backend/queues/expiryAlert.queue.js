const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");

const expiryAlertQueue = new Queue("expiry-alert-queue", {
  connection,
});

module.exports = expiryAlertQueue;