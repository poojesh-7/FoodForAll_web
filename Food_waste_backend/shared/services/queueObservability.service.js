const pool = require("../config/db");
const expiryQueue = require("../../queues/expiry.queue");
const expiryAlertQueue = require("../../queues/expiryAlert.queue");
const pickupQueue = require("../../queues/pickup.queue");
const deliveryQueue = require("../../queues/delivery.queue");
const notificationQueue = require("../../queues/notification.queue");
const paymentQueue = require("../../queues/payment.queue");
const refundQueue = require("../../queues/refund.queue");
const operationalCleanupQueue = require("../../queues/operationalCleanup.queue");
const { ensureObservabilitySchema, recordAlert } = require("./observability.service");

const monitoredQueues = [
  expiryQueue,
  expiryAlertQueue,
  pickupQueue,
  deliveryQueue,
  notificationQueue,
  paymentQueue,
  refundQueue,
  operationalCleanupQueue,
];

const queuesByName = new Map(monitoredQueues.map((queue) => [queue.name, queue]));

async function serializeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    attempts: job.opts?.attempts || 1,
    failedReason: job.failedReason || null,
    timestamp: job.timestamp,
    processedOn: job.processedOn || null,
    finishedOn: job.finishedOn || null,
    delay: job.delay || 0,
    data: {
      reservationId: job.data?.reservationId || null,
      reservationIds: Array.isArray(job.data?.reservationIds)
        ? job.data.reservationIds
        : undefined,
      userId: job.data?.userId || null,
      orderId: job.data?.orderId || job.data?.order_id || null,
    },
  };
}

async function getWorkerHeartbeats() {
  try {
    await ensureObservabilitySchema();
    const result = await pool.query(`
      SELECT worker_name, queue_name, status, last_job_id, last_seen_at, metadata
      FROM worker_heartbeats
      ORDER BY worker_name
    `);
    return result.rows;
  } catch {
    return [];
  }
}

async function getQueueHealth({ includeJobs = true } = {}) {
  const heartbeats = await getWorkerHeartbeats();
  const heartbeatsByQueue = new Map(
    heartbeats.map((heartbeat) => [heartbeat.queue_name || heartbeat.worker_name, heartbeat])
  );

  return Promise.all(
    monitoredQueues.map(async (queue) => {
      const [counts, isPaused, failedJobs, activeJobs, delayedJobs] =
        await Promise.all([
          queue.getJobCounts(
            "active",
            "waiting",
            "delayed",
            "failed",
            "completed",
            "paused",
            "waiting-children"
          ),
          queue.isPaused(),
          includeJobs ? queue.getFailed(0, 9) : Promise.resolve([]),
          includeJobs ? queue.getActive(0, 9) : Promise.resolve([]),
          includeJobs ? queue.getDelayed(0, 9) : Promise.resolve([]),
        ]);

      const retryExhausted = failedJobs.filter((job) => {
        const attempts = Number(job.opts?.attempts || 1);
        return Number(job.attemptsMade || 0) >= attempts;
      });
      const now = Date.now();
      const stuckActive = activeJobs.filter((job) => {
        if (!job.processedOn) return false;
        return now - Number(job.processedOn) > 15 * 60 * 1000;
      });
      const status =
        isPaused || retryExhausted.length > 0 || stuckActive.length > 0
          ? "degraded"
          : "healthy";

      if (retryExhausted.length > 0) {
        void recordAlert({
          alertKey: `${queue.name}:retry_exhausted_visible`,
          category: "queue",
          severity: "error",
          message: `${retryExhausted.length} retry-exhausted jobs in ${queue.name}`,
          metadata: { queueName: queue.name, jobIds: retryExhausted.map((job) => job.id) },
        });
      }

      if (stuckActive.length > 0) {
        void recordAlert({
          alertKey: `${queue.name}:stuck_jobs`,
          category: "queue",
          severity: "warning",
          message: `${stuckActive.length} stuck active jobs in ${queue.name}`,
          metadata: { queueName: queue.name, jobIds: stuckActive.map((job) => job.id) },
        });
      }

      return {
        name: queue.name,
        status,
        is_paused: isPaused,
        counts,
        retry_exhausted_count: retryExhausted.length,
        stuck_active_count: stuckActive.length,
        worker: heartbeatsByQueue.get(queue.name) || null,
        failed_jobs: await Promise.all(failedJobs.map(serializeJob)),
        active_jobs: await Promise.all(activeJobs.map(serializeJob)),
        delayed_jobs: await Promise.all(delayedJobs.map(serializeJob)),
      };
    })
  );
}

async function cleanupQueues() {
  const results = [];
  for (const queue of monitoredQueues) {
    const [completed, failed] = await Promise.all([
      queue.clean(24 * 60 * 60 * 1000, 1000, "completed"),
      queue.clean(14 * 24 * 60 * 60 * 1000, 2000, "failed"),
    ]);

    results.push({
      queue: queue.name,
      completed: completed.length,
      failed: failed.length,
    });
  }

  return results;
}

async function retryFailedJob(queueName, jobId) {
  const queue = queuesByName.get(queueName);
  if (!queue) {
    const error = new Error("Queue not found");
    error.statusCode = 404;
    throw error;
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    const error = new Error("Job not found");
    error.statusCode = 404;
    throw error;
  }

  await job.retry("failed");
  return serializeJob(job);
}

module.exports = {
  cleanupQueues,
  getQueueHealth,
  monitoredQueues,
  retryFailedJob,
};
