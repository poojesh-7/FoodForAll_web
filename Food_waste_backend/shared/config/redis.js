const { createClient } = require("redis");

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required");
}

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("connect", () => {
  console.log("Redis connected");
});

redisClient.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err.message);
});

let connecting;

const connectRedis = async () => {
  if (redisClient.isOpen) return;

  if (!connecting) {
    connecting = redisClient.connect().catch((err) => {
      console.error("Initial Redis connection failed:", err.message);
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
