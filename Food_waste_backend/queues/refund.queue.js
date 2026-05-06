const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");

const refundQueue = new Queue("refund-queue", {
  connection,
});

module.exports = refundQueue;