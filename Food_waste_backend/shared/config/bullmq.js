const IORedis = require("ioredis");
const logger = require("../utils/logger");

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  connectionName: `${process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local"}:bullmq`,
  retryStrategy: (times) => Math.min(times * 100, 5000),
});

connection.on("connect", () => {
  logger.info("BullMQ Redis connected");
});

connection.on("error", (err) => {
  logger.error("BullMQ Redis error", { err });
});

module.exports = connection;
