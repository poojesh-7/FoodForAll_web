const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");

const notificationQueue = new Queue("notification-queue", {
  connection,
});

module.exports = notificationQueue;