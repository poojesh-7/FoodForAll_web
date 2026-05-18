const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const operationalCleanupQueue = require("../queues/operationalCleanup.queue");
const { cleanupQueues } = require("../shared/services/queueObservability.service");
const {
  ensureObservabilitySchema,
  recordOperationalEvent,
} = require("../shared/services/observability.service");
const {
  ensurePaymentHardeningSchema,
} = require("../shared/services/paymentReconciliation.service");

logger.info("Operational cleanup worker started");

operationalCleanupQueue
  .add(
    "operational-retention-cleanup",
    {},
    {
      jobId: "operational-retention-cleanup",
      repeat: { every: 24 * 60 * 60 * 1000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 30 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 100 },
    }
  )
  .catch((err) => {
    logger.warn("Operational cleanup scheduling failed", { err });
  });

const cleanupWorker = new Worker(
  "operational-cleanup-queue",
  withWorkerBoundary("operational-cleanup-queue", async () => {
    await ensureObservabilitySchema();
    await ensurePaymentHardeningSchema();

    const client = await pool.connect();
    const counts = {};

    try {
      await client.query("BEGIN");

      const queries = [
        [
          "old_notifications",
          `DELETE FROM notifications
           WHERE is_read=true
           AND created_at < NOW() - INTERVAL '90 days'`,
        ],
        [
          "old_operational_events",
          `DELETE FROM operational_events
           WHERE created_at < NOW() - INTERVAL '90 days'`,
        ],
        [
          "resolved_operational_alerts",
          `DELETE FROM operational_alerts
           WHERE status <> 'open'
           AND last_seen_at < NOW() - INTERVAL '180 days'`,
        ],
        [
          "processed_webhooks",
          `DELETE FROM cashfree_webhook_events
           WHERE status='processed'
           AND received_at < NOW() - INTERVAL '90 days'`,
        ],
        [
          "stale_worker_heartbeats",
          `DELETE FROM worker_heartbeats
           WHERE last_seen_at < NOW() - INTERVAL '30 days'`,
        ],
      ];

      for (const [name, sql] of queries) {
        const result = await client.query(sql);
        counts[name] = result.rowCount;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const queueCleanup = await cleanupQueues();
    logger.info("Operational retention cleanup completed", {
      counts,
      queueCleanup,
    });
    await recordOperationalEvent({
      category: "operations",
      severity: "info",
      eventName: "retention_cleanup_completed",
      metadata: { counts, queueCleanup },
    });
  }),
  workerOptions(connection, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 30 },
    removeOnFail: { age: 14 * 24 * 60 * 60, count: 100 },
  })
);

registerWorkerEvents(cleanupWorker, "operational-cleanup-queue");
