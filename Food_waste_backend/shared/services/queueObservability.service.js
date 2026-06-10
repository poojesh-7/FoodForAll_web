const pool = require("../config/db");
const expiryQueue = require("../../queues/expiry.queue");
const expiryAlertQueue = require("../../queues/expiryAlert.queue");
const pickupQueue = require("../../queues/pickup.queue");
const deliveryQueue = require("../../queues/delivery.queue");
const notificationQueue = require("../../queues/notification.queue");
const paymentQueue = require("../../queues/payment.queue");
const refundQueue = require("../../queues/refund.queue");
const trustQueue = require("../../queues/trust.queue");
const operationalCleanupQueue = require("../../queues/operationalCleanup.queue");
const deadLetterQueue = require("../../queues/deadLetter.queue");
const { ensureObservabilitySchema, recordAlert } = require("./observability.service");
const { setGauge, setQueueCountGauge } = require("./metrics.service");
const {
  DELAYED_OVERDUE_MS,
  classifyDelayedJob,
} = require("../utils/queueJobClassification");
const { heartbeatStatus } = require("../utils/heartbeatStatus");

const STALE_HEARTBEAT_MS = Number(process.env.WORKER_STALE_HEARTBEAT_MS || 90000);
const STUCK_ACTIVE_MS = Number(process.env.QUEUE_STUCK_ACTIVE_MS || 15 * 60 * 1000);

const monitoredQueueConfigs = [
  { queue: expiryQueue, workerRequired: true },
  { queue: expiryAlertQueue, workerRequired: true },
  { queue: pickupQueue, workerRequired: true },
  { queue: deliveryQueue, workerRequired: true },
  { queue: notificationQueue, workerRequired: true },
  { queue: paymentQueue, workerRequired: true },
  { queue: refundQueue, workerRequired: true },
  { queue: trustQueue, workerRequired: true },
  { queue: operationalCleanupQueue, workerRequired: true },
  { queue: deadLetterQueue, workerRequired: false, deadLetter: true },
];

const monitoredQueues = monitoredQueueConfigs.map(({ queue }) => queue);
const queuesByName = new Map(monitoredQueues.map((queue) => [queue.name, queue]));

async function serializeJob(queueName, job) {
  if (!job) return null;
  const dueAt =
    job.delay && job.timestamp
      ? new Date(Number(job.timestamp) + Number(job.delay)).toISOString()
      : null;
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
    dueAt,
    ...(dueAt ? classifyDelayedJob(queueName, job) : {}),
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
      SELECT worker_name, queue_name, status, last_job_id, last_seen_at, metadata,
             EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS seconds_since_seen
      FROM worker_heartbeats
      ORDER BY worker_name
    `);
    return result.rows;
  } catch {
    return [];
  }
}

function getHeartbeatStatus(heartbeat) {
  return heartbeatStatus(heartbeat, STALE_HEARTBEAT_MS);
}

async function getQueueHealth({ includeJobs = true } = {}) {
  const heartbeats = await getWorkerHeartbeats();
  const heartbeatsByQueue = new Map(
    heartbeats.map((heartbeat) => [heartbeat.queue_name || heartbeat.worker_name, heartbeat])
  );

  return Promise.all(
    monitoredQueueConfigs.map(async ({ queue, workerRequired, deadLetter }) => {
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

      const heartbeat = heartbeatsByQueue.get(queue.name) || null;
      const heartbeatStatus = workerRequired ? getHeartbeatStatus(heartbeat) : "not_required";
      const retryExhausted = failedJobs.filter((job) => {
        const attempts = Number(job.opts?.attempts || 1);
        return Number(job.attemptsMade || 0) >= attempts;
      });
      const now = Date.now();
      const stuckActive = activeJobs.filter((job) => {
        if (!job.processedOn) return false;
        return now - Number(job.processedOn) > STUCK_ACTIVE_MS;
      });
      const overdueDelayed = delayedJobs.filter((job) => {
        const dueAt = Number(job.timestamp || 0) + Number(job.delay || 0);
        return dueAt > 0 && now - dueAt > DELAYED_OVERDUE_MS;
      });
      const deadLetterWaiting =
        deadLetter &&
        Number(counts.waiting || 0) +
          Number(counts.delayed || 0) +
          Number(counts.failed || 0) >
          0;
      const status =
        isPaused ||
        retryExhausted.length > 0 ||
        stuckActive.length > 0 ||
        overdueDelayed.length > 0 ||
        heartbeatStatus === "missing" ||
        heartbeatStatus === "stale" ||
        heartbeatStatus === "invalid" ||
        deadLetterWaiting
          ? "degraded"
          : "healthy";

      for (const [state, value] of Object.entries(counts)) {
        setQueueCountGauge(queue.name, state, Number(value || 0));
      }
      setGauge("food_rescue_queue_status", { queue: queue.name }, status === "healthy" ? 1 : 0);
      setGauge("food_rescue_queue_retry_exhausted", { queue: queue.name }, retryExhausted.length);
      setGauge("food_rescue_queue_stuck_active", { queue: queue.name }, stuckActive.length);
      setGauge("food_rescue_queue_overdue_delayed", { queue: queue.name }, overdueDelayed.length);

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

      if (overdueDelayed.length > 0) {
        void recordAlert({
          alertKey: `${queue.name}:overdue_delayed_jobs`,
          category: "queue",
          severity: "warning",
          message: `${overdueDelayed.length} overdue delayed jobs in ${queue.name}`,
          metadata: {
            queueName: queue.name,
            jobIds: overdueDelayed.map((job) => job.id),
            classifications: overdueDelayed.map((job) =>
              classifyDelayedJob(queue.name, job)
            ),
          },
        });
      }

      if (workerRequired && heartbeatStatus !== "ok") {
        void recordAlert({
          alertKey: `${queue.name}:worker_heartbeat_${heartbeatStatus}`,
          category: "queue",
          severity: heartbeatStatus === "missing" ? "warning" : "error",
          message: `Worker heartbeat ${heartbeatStatus} for ${queue.name}`,
          metadata: { queueName: queue.name, heartbeat },
        });
      }

      if (deadLetterWaiting) {
        void recordAlert({
          alertKey: `${queue.name}:dead_letter_jobs_visible`,
          category: "queue",
          severity: "error",
          message: `${queue.name} contains dead-letter jobs requiring inspection`,
          metadata: { queueName: queue.name, counts },
        });
      }

      return {
        name: queue.name,
        status,
        is_paused: isPaused,
        counts,
        retry_exhausted_count: retryExhausted.length,
        stuck_active_count: stuckActive.length,
        overdue_delayed_count: overdueDelayed.length,
        worker_heartbeat_status: heartbeatStatus,
        worker: heartbeat,
        failed_jobs: await Promise.all(failedJobs.map((job) => serializeJob(queue.name, job))),
        active_jobs: await Promise.all(activeJobs.map((job) => serializeJob(queue.name, job))),
        delayed_jobs: await Promise.all(delayedJobs.map((job) => serializeJob(queue.name, job))),
      };
    })
  );
}

async function cleanupQueues() {
  const results = [];
  for (const { queue, deadLetter } of monitoredQueueConfigs) {
    if (deadLetter) {
      results.push({
        queue: queue.name,
        completed: 0,
        failed: 0,
        skipped: true,
      });
      continue;
    }

    const [completed, failed] = await Promise.all([
      queue.clean(24 * 60 * 60 * 1000, 1000, "completed"),
      queue.clean(30 * 24 * 60 * 60 * 1000, 2000, "failed"),
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
  classifyDelayedJob,
  cleanupQueues,
  getQueueHealth,
  monitoredQueueConfigs,
  monitoredQueues,
  retryFailedJob,
};
