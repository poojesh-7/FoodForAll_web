const pool = require("../shared/config/db");

function startNotificationCleanupWorker() {
  setInterval(async () => {
    try {
      await pool.query(`
        DELETE FROM notifications
        WHERE created_at < NOW() - INTERVAL '30 days'
      `);

      console.log("🧹 Old notifications cleaned");
    } catch (err) {
      console.error("Cleanup error:", err);
    }
  }, 86400000); // once per day
}

module.exports = startNotificationCleanupWorker;
