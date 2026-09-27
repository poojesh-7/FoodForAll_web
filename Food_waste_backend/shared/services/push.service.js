const admin = require("../config/firebase");
const pool = require("../config/db");
const logger = require("../utils/logger");

async function sendPush(userId, type, title, message, notificationId) {
  if (!admin || !admin.messaging) {
    return;
  }
  
  try {
    const user = await pool.query(
      "SELECT fcm_token FROM users WHERE id=$1",
      [userId]
    );

    const token = user.rows[0]?.fcm_token;

    if (!token) return;

    await admin.messaging().send({
      token,
      notification: {
        title,
        body: message,
      },
      data: {
        type,
        ...(notificationId ? { notification_id: String(notificationId) } : {}),
      },
      ...(notificationId
        ? { android: { notification: { tag: String(notificationId) } } }
        : {}),
    });
  } catch (err) {
    logger.error("Push notification failed", { err, userId });

    return;
  }
}

module.exports = { sendPush };