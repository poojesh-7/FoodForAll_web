const { createClient } = require("redis");
const logger = require("../utils/logger");

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required");
}

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("connect", () => {
  logger.info("Redis connected");
});

redisClient.on("reconnecting", () => {
  logger.warn("Redis reconnecting");
});

redisClient.on("error", (err) => {
  logger.error("Redis error", { err });
});

let connecting;

const connectRedis = async () => {
  if (redisClient.isOpen) return;

  if (!connecting) {
    connecting = redisClient.connect().catch((err) => {
      logger.error("Initial Redis connection failed", { err });
      connecting = null;
      setTimeout(connectRedis, 5000); // retry
    });
  }

  await connecting;
};

connectRedis();

process.on("SIGTERM", async () => {
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } finally {
    process.exit(0);
  }
});

module.exports = redisClient;
