const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");

const expiryQueue = new Queue("expiry-queue", {
  connection,
});

module.exports = expiryQueue;