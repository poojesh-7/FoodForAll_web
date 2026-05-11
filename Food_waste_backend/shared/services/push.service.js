const admin = require("../config/firebase");
const pool = require("../config/db");
const logger = require("../utils/logger");

async function sendPush(userId, type, title, message) {
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
      },
    });
  } catch (err) {
    logger.error("Push notification failed", { err, userId });
    throw err;
  }
}

module.exports = { sendPush };
