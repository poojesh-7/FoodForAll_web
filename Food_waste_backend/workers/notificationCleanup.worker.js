const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");

function startNotificationCleanupWorker() {
  setInterval(async () => {
    try {
      await pool.query(`
        DELETE FROM notifications
        WHERE created_at < NOW() - INTERVAL '30 days'
      `);

      logger.info("Old notifications cleaned");
    } catch (err) {
      logger.error("Notification cleanup failed", { err });
    }
  }, 86400000); // once per day
}

module.exports = startNotificationCleanupWorker;
