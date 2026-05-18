const logger = require("./logger");
const deadLetterQueue = require("../../queues/deadLetter.queue");
const { runWithContext, contextFromJob } = require("./requestContext");
const {
  heartbeatWorker,
  recordAlert,
  recordOperationalEvent,
} = require("../services/observability.service");

function registerWorkerEvents(worker, workerName) {
  worker.on("completed", (job) => {
    runWithContext(contextFromJob(job, workerName), () => {
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
    runWithContext(contextFromJob(job, workerName), () => {
      const attempts = Number(job?.opts?.attempts || 1);
      const retryExhausted = Number(job?.attemptsMade || 0) >= attempts;
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
        void deadLetterQueue.add(
          "retry-exhausted",
          {
            sourceQueue: workerName,
            jobId: job?.id,
            jobName: job?.name,
            data: job?.data,
            failedReason: job?.failedReason || err?.message,
            attemptsMade: job?.attemptsMade,
            failedAt: new Date().toISOString(),
          },
          {
            jobId: `${workerName}:${job?.id}:retry-exhausted`,
          }
        );
        void recordAlert({
          alertKey: `${workerName}:retry_exhausted`,
          category: "queue",
          severity: "error",
          message: `Retry exhausted in ${workerName}`,
          metadata: { jobId: job?.id, jobName: job?.name },
        });
      }
    });
  });

  worker.on("error", (err) => {
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

  return worker;
}

module.exports = {
  registerWorkerEvents,
};
