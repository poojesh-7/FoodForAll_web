const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");

const paymentQueue = new Queue("payment-queue", {
  connection,
});

module.exports = paymentQueue;