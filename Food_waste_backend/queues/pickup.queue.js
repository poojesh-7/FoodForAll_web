const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");

const pickupQueue = new Queue("pickup-queue", {
  connection,
});

module.exports = pickupQueue;