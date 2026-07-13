const pool = require("../config/db");
const { sendPush } = require("./push.service");
const { publishSocketEvent } = require("./realtime.service");
const { sendBrowserPushNotification } = require("./webPush.service");

function normalizeIdempotencyKey(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 240) : null;
}

async function notifyUser(userId, type, title, message, data = {}, options = {}) {
  const idempotencyKey = normalizeIdempotencyKey(
    options.idempotencyKey ||
      options.idempotency_key ||
      data?.idempotencyKey ||
      data?.idempotency_key
  );

  const result = await pool.query(
    `
    INSERT INTO notifications (user_id,type,title,message,idempotency_key)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET idempotency_key=notifications.idempotency_key
    RETURNING *
    `,
    [userId, type, title, message, idempotencyKey]
  );
  const notification = result.rows[0];

  await publishSocketEvent(
    `user:${userId}`,
    "notification",
    {
      ...notification,
      ...data,
    },
    { throwOnError: true }
  );

  await sendPush(userId, type, title, message);

  try {
    await sendBrowserPushNotification(notification, data);
  } catch (error) {
    const logger = require("../utils/logger");
    logger.error("Browser push failed", {
      userId,
      notificationId: notification?.id,
      type,
      error: error?.message || error,
    });
  }

  return notification;
}

module.exports = { notifyUser };
