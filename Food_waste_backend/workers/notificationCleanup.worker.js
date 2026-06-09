const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { registerManagedInterval } = require("../shared/utils/queueRuntime");

function startNotificationCleanupWorker() {
  registerManagedInterval("notification-cleanup", async () => {
    try {
      const result = await pool.query(`
        UPDATE notifications
        SET archive_status='archived',
            archived_at=COALESCE(archived_at, NOW()),
            archive_metadata=archive_metadata || jsonb_build_object(
              'archived_by', 'notification_cleanup_worker',
              'policy_key', retention_policy_key,
              'reason', 'age_based_notification_retention'
            )
        WHERE created_at < NOW() - INTERVAL '180 days'
        AND archive_status='active'
      `);

      logger.info("Old notifications archived", {
        archived: result.rowCount,
        policyKey: "notifications",
      });
    } catch (err) {
      logger.error("Notification cleanup failed", { err });
    }
  }, 86400000);
}

module.exports = startNotificationCleanupWorker;
