const IORedis = require("ioredis");

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // 🔥 REQUIRED
});


connection.on("connect", () => {
  console.log("BullMQ Redis connected");
});

connection.on("error", (err) => {
  console.error("BullMQ Redis error:", err.message);
});

module.exports = connection;