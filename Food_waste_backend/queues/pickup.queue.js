const { Queue } = require("bullmq");
const connection = require("../shared/config/bullmq");
const { queueOptions } = require("../shared/utils/queueOptions");

const pickupQueue = new Queue("pickup-queue", queueOptions(connection));

module.exports = pickupQueue;
