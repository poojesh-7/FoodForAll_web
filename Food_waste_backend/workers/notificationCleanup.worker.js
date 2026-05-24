const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { registerManagedInterval } = require("../shared/utils/queueRuntime");

function startNotificationCleanupWorker() {
  registerManagedInterval("notification-cleanup", async () => {
    try {
      await pool.query(`
        DELETE FROM notifications
        WHERE created_at < NOW() - INTERVAL '30 days'
      `);

      logger.info("Old notifications cleaned");
    } catch (err) {
      logger.error("Notification cleanup failed", { err });
    }
  }, 86400000);
}

module.exports = startNotificationCleanupWorker;
