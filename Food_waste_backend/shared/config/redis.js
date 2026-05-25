const { createClient } = require("redis");
const logger = require("../utils/logger");
const {
  recordAlert,
  recordOperationalEvent,
} = require("../services/observability.service");
const { setGauge } = require("../services/metrics.service");

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required");
}

const redisClient = createClient({
  url: process.env.REDIS_URL,
  name: `${process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local"}:api`,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 5000),
  },
});

redisClient.on("connect", () => {
  setGauge("food_rescue_dependency_health", { dependency: "redis" }, 1);
  logger.info("Redis connected");
  void recordOperationalEvent({
    category: "redis",
    severity: "info",
    eventName: "redis_connected",
  });
});

redisClient.on("reconnecting", () => {
  setGauge("food_rescue_dependency_health", { dependency: "redis" }, 0);
  logger.warn("Redis reconnecting");
  void recordOperationalEvent({
    category: "redis",
    severity: "warning",
    eventName: "redis_reconnecting",
  });
});

redisClient.on("error", (err) => {
  setGauge("food_rescue_dependency_health", { dependency: "redis" }, 0);
  logger.error("Redis error", { err });
  void recordAlert({
    alertKey: "redis:connection_error",
    category: "redis",
    severity: "error",
    message: "Redis connection error",
    metadata: { message: err?.message },
  });
});

redisClient.on("end", () => {
  setGauge("food_rescue_dependency_health", { dependency: "redis" }, 0);
  logger.warn("Redis connection closed");
  void recordAlert({
    alertKey: "redis:connection_closed",
    category: "redis",
    severity: "warning",
    message: "Redis connection closed",
  });
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

module.exports = redisClient;
