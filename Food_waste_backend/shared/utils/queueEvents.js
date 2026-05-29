const logger = require("./logger");
const deadLetterQueue = require("../../queues/deadLetter.queue");
const { classifyDeadLetter } = require("./queueFailureClassification");
const { runWithContext, contextFromJob } = require("./requestContext");
const {
  registerManagedInterval,
  registerWorker,
} = require("./queueRuntime");
const {
  heartbeatWorker,
  recordAlert,
  recordOperationalEvent,
} = require("../services/observability.service");
const { recordQueueJob } = require("../services/metrics.service");

const HEARTBEAT_INTERVAL_MS = Number(
  process.env.WORKER_HEARTBEAT_INTERVAL_MS || 30000
);

function enqueueDeadLetter(workerName, job, err) {
  const classification = classifyDeadLetter(workerName, job, err);

  return deadLetterQueue
    .add(
      "retry-exhausted",
      {
        sourceQueue: workerName,
        jobId: job?.id,
        jobName: job?.name,
        data: job?.data,
        opts: job?.opts,
        failedReason: job?.failedReason || err?.message,
        stacktrace: job?.stacktrace || [],
        attemptsMade: job?.attemptsMade,
        failedAt: new Date().toISOString(),
        classification,
      },
      {
        jobId: `${workerName}:${job?.id}:retry-exhausted`,
      }
    )
    .catch((deadLetterErr) => {
      logger.error("Dead-letter enqueue failed", {
        queue: workerName,
        jobId: job?.id,
        err: deadLetterErr,
      });
    });
}

function registerWorkerEvents(worker, workerName) {
  const activeJobs = new Set();
  const activeJobStartedAt = new Map();

  registerWorker(workerName, worker);
  void heartbeatWorker(workerName, workerName, "running", {
    processId: process.pid,
    startedAt: new Date().toISOString(),
  });
  registerManagedInterval(
    `worker-heartbeat:${workerName}`,
    () =>
      heartbeatWorker(
        workerName,
        workerName,
        activeJobs.size > 0 ? "processing" : "running",
        {
          processId: process.pid,
          activeJobs: activeJobs.size,
        }
      ),
    HEARTBEAT_INTERVAL_MS
  );

  worker.on("active", (job) => {
    const jobId = String(job?.id);
    activeJobs.add(jobId);
    activeJobStartedAt.set(jobId, Date.now());
    runWithContext(contextFromJob(job, workerName), () => {
      if (job?.timestamp) {
        recordQueueJob({
          queueName: workerName,
          event: "active",
          waitMs: Math.max(0, Date.now() - Number(job.timestamp)),
        });
      } else {
        recordQueueJob({ queueName: workerName, event: "active" });
      }
      logger.queue("Queue job active", {
        queue: workerName,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
      });
    });
  });

  worker.on("completed", (job) => {
    const jobId = String(job?.id);
    const startedAt = activeJobStartedAt.get(jobId);
    activeJobs.delete(jobId);
    activeJobStartedAt.delete(jobId);
    runWithContext(contextFromJob(job, workerName), () => {
      recordQueueJob({
        queueName: workerName,
        event: "completed",
        durationMs: startedAt ? Date.now() - startedAt : undefined,
      });
      logger.queue("Queue job completed", {
        queue: workerName,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
      });
      void heartbeatWorker(workerName, workerName, "running", {
        lastJobId: job?.id,
        jobName: job?.name,
      });
    });
  });

  worker.on("failed", (job, err) => {
    const jobId = String(job?.id);
    const startedAt = activeJobStartedAt.get(jobId);
    activeJobs.delete(jobId);
    activeJobStartedAt.delete(jobId);
    runWithContext(contextFromJob(job, workerName), () => {
      const attempts = Number(job?.opts?.attempts || 1);
      const retryExhausted = Number(job?.attemptsMade || 0) >= attempts;
      recordQueueJob({
        queueName: workerName,
        event: retryExhausted ? "retry_exhausted" : "failed",
        durationMs: startedAt ? Date.now() - startedAt : undefined,
        retryExhausted,
      });
      logger.error("Queue job failed", {
        queue: workerName,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        attempts,
        retryExhausted,
        err,
      });
      void recordOperationalEvent({
        category: "queue",
        severity: retryExhausted ? "error" : "warning",
        eventName: retryExhausted ? "queue_retry_exhausted" : "queue_job_failed",
        metadata: {
          queueName: workerName,
          jobId: job?.id,
          jobName: job?.name,
          attemptsMade: job?.attemptsMade,
          attempts,
          failedReason: job?.failedReason,
        },
      });
      if (retryExhausted) {
        const classification = classifyDeadLetter(workerName, job, err);
        void enqueueDeadLetter(workerName, job, err);
        void recordAlert({
          alertKey: `${workerName}:retry_exhausted`,
          category: "queue",
          severity: "error",
          message: `Retry exhausted in ${workerName}`,
          metadata: { jobId: job?.id, jobName: job?.name, classification },
        });
      }
    });
  });

  worker.on("stalled", (jobId, previous) => {
    const normalizedJobId = String(jobId);
    activeJobs.delete(normalizedJobId);
    activeJobStartedAt.delete(normalizedJobId);
    recordQueueJob({ queueName: workerName, event: "stalled" });
    logger.warn("Queue job stalled and will be recovered by BullMQ", {
      queue: workerName,
      jobId: normalizedJobId,
      previous,
    });
    void recordOperationalEvent({
      category: "queue",
      severity: "warning",
      eventName: "queue_job_stalled",
      metadata: {
        queueName: workerName,
        jobId: normalizedJobId,
        previous,
      },
    });
    void recordAlert({
      alertKey: `${workerName}:stalled_job`,
      category: "queue",
      severity: "warning",
      message: `Stalled job detected in ${workerName}`,
      metadata: { jobId: normalizedJobId, previous },
    });
    void heartbeatWorker(workerName, workerName, "stalled", {
      jobId: normalizedJobId,
      previous,
    });
  });

  worker.on("error", (err) => {
    recordQueueJob({ queueName: workerName, event: "worker_error" });
    logger.error("Queue worker error", {
      queue: workerName,
      err,
    });
    void heartbeatWorker(workerName, workerName, "error", {
      message: err?.message,
    });
    void recordAlert({
      alertKey: `${workerName}:worker_error`,
      category: "queue",
      severity: "error",
      message: `Worker error in ${workerName}`,
      metadata: { message: err?.message },
    });
  });

  worker.on("closed", () => {
    logger.info("Queue worker closed", { queue: workerName });
    void heartbeatWorker(workerName, workerName, "closed", {
      processId: process.pid,
    });
  });

  return worker;
}

module.exports = {
  classifyDeadLetter,
  registerWorkerEvents,
};
