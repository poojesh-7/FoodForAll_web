const logger = require("./logger");

function registerWorkerEvents(worker, workerName) {
  worker.on("completed", (job) => {
    logger.info("Queue job completed", {
      queue: workerName,
      jobId: job?.id,
      jobName: job?.name,
    });
  });

  worker.on("failed", (job, err) => {
    logger.error("Queue job failed", {
      queue: workerName,
      jobId: job?.id,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade,
      attempts: job?.opts?.attempts,
      err,
    });
  });

  worker.on("error", (err) => {
    logger.error("Queue worker error", {
      queue: workerName,
      err,
    });
  });

  return worker;
}

module.exports = {
  registerWorkerEvents,
};
