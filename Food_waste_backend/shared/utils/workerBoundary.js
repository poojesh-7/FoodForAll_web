const logger = require("./logger");
const { contextFromJob, runWithContext } = require("./requestContext");
const { QueueProcessingError } = require("./errors");
const {
  heartbeatWorker,
  recordOperationalEvent,
} = require("../services/observability.service");
const { captureError } = require("../services/errorTracking.service");

function withWorkerBoundary(workerName, handler) {
  return async (job) =>
    runWithContext(contextFromJob(job, workerName), async () => {
      const attempts = Number(job?.opts?.attempts || 1);

      await heartbeatWorker(workerName, workerName, "processing", {
        lastJobId: job?.id,
        jobName: job?.name,
      });
      logger.queue("Queue job started", {
        queue: workerName,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        attempts,
      });

      try {
        const result = await handler(job);
        await heartbeatWorker(workerName, workerName, "running", {
          lastJobId: job?.id,
          jobName: job?.name,
        });
        return result;
      } catch (err) {
        const isRetryExhausted = Number(job?.attemptsMade || 0) + 1 >= attempts;
        const wrapped =
          err instanceof QueueProcessingError
            ? err
            : new QueueProcessingError(err?.message || "Queue job failed", {
                details: { originalName: err?.name },
              });

        await captureError(wrapped, {
          category: "queue",
          eventName: "queue_job_failed",
          queueName: workerName,
          jobId: job?.id,
          jobName: job?.name,
          attemptsMade: job?.attemptsMade,
          attempts,
          alert: isRetryExhausted,
          alertKey: isRetryExhausted ? `${workerName}:retry_exhausted` : undefined,
          alertMessage: `Retry exhausted in ${workerName}`,
        });

        await recordOperationalEvent({
          category: "queue",
          severity: isRetryExhausted ? "error" : "warning",
          eventName: isRetryExhausted ? "queue_retry_exhausted" : "queue_retry",
          metadata: {
            queueName: workerName,
            jobId: job?.id,
            jobName: job?.name,
            attemptsMade: job?.attemptsMade,
            attempts,
          },
        });

        await heartbeatWorker(workerName, workerName, "failed", {
          lastJobId: job?.id,
          jobName: job?.name,
          retryExhausted: isRetryExhausted,
        });

        throw err;
      }
    });
}

module.exports = {
  withWorkerBoundary,
};
