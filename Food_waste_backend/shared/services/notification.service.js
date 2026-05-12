const pool = require("../config/db");
const redis = require("../config/redis");
const { sendPush } = require("./push.service");

async function notifyUser(userId, type, title, message, data = {}) {
  // ✅ single DB insert
  const result = await pool.query(
    `
    INSERT INTO notifications (user_id,type,title,message)
    VALUES ($1,$2,$3,$4)
    RETURNING *
    `,
    [userId, type, title, message]
  );
  const notification = result.rows[0];

  // 🔌 realtime
  await redis.publish(
    "socket_events",
    JSON.stringify({
      room: `user:${userId}`,
      event: "notification",
      data: { ...notification, ...data },
    })
  );

  // 🔥 push (retry handled by BullMQ worker)
  await sendPush(userId, type, title, message);

  return notification;
}

module.exports = { notifyUser };
