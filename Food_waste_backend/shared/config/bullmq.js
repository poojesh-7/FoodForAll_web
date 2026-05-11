const IORedis = require("ioredis");
const logger = require("../utils/logger");

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

connection.on("connect", () => {
  logger.info("BullMQ Redis connected");
});

connection.on("error", (err) => {
  logger.error("BullMQ Redis error", { err });
});

module.exports = connection;
