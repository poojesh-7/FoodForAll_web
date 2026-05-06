const pool = require("../config/db");
const redis = require("../config/redis");
const { sendPush } = require("./push.service");

async function notifyUser(userId, type, title, message, data = {}) {
  // ✅ single DB insert
  await pool.query(
    `
    INSERT INTO notifications (user_id,type,title,message)
    VALUES ($1,$2,$3,$4)
    `,
    [userId, type, title, message]
  );

  // 🔌 realtime
  await redis.publish(
    "socket_events",
    JSON.stringify({
      room: `user:${userId}`,
      event: "notification",
      data: { type, title, message, ...data },
    })
  );

  // 🔥 push (retry handled by BullMQ worker)
  await sendPush(userId, type, title, message);
}

module.exports = { notifyUser };