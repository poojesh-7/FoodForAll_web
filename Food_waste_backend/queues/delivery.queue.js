const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");

const deliveryQueue = new Queue("delivery-queue", {
  connection,
});

module.exports = deliveryQueue;