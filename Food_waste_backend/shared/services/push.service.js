const admin = require("../config/firebase");
const pool = require("../config/db");

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
    console.error("Push Service Error:", err.message);
    throw err; // 🔥 IMPORTANT for retry
  }
}

module.exports = { sendPush };