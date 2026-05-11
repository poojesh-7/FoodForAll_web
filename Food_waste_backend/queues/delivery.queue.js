const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const deliveryQueue = new Queue("delivery-queue", queueOptions(connection));

module.exports = deliveryQueue;
