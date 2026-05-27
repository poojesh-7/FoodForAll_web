const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const trustQueue = require("../queues/trust.queue");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { jobOptions, workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const {
  processTrustEventBatch,
} = require("../shared/services/trustWorker.service");
const {
  deriveLifecycleTrustEvents,
} = require("../shared/services/trustLifecycleEvent.service");

logger.info("Trust worker started");

trustQueue
  .add(
    "process-trust-events",
    {},
    jobOptions("operational", {
      jobId: "trust-processing-sweep",
      repeat: { every: Number(process.env.TRUST_PROCESSING_SWEEP_MS || 60 * 1000) },
      removeOnComplete: { age: 60 * 60, count: 100 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
    })
  )
  .catch((err) => {
    logger.warn("Trust processing sweep scheduling failed", { err });
  });

trustQueue
  .add(
    "derive-lifecycle-trust-events",
    {},
    jobOptions("operational", {
      jobId: "trust-lifecycle-derivation-sweep",
      repeat: { every: Number(process.env.TRUST_DERIVATION_SWEEP_MS || 2 * 60 * 1000) },
      removeOnComplete: { age: 60 * 60, count: 100 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
    })
  )
  .catch((err) => {
    logger.warn("Trust lifecycle derivation sweep scheduling failed", { err });
  });

const trustWorker = new Worker(
  "trust-queue",
  withWorkerBoundary("trust-queue", async (job) => {
    if (job.name === "derive-lifecycle-trust-events") {
      const summary = await deriveLifecycleTrustEvents();
      logger.info("Trust lifecycle derivation completed", {
        jobId: job.id,
        summary,
      });
      return;
    }

    const { eventKey } = job.data || {};
    const results = await processTrustEventBatch({ eventKey });
    logger.info("Trust processing job completed", {
      jobId: job.id,
      eventKey,
      count: results.length,
    });
  }),
  workerOptions(connection, {
    concurrency: Number(process.env.TRUST_WORKER_CONCURRENCY || 2),
  })
);

registerWorkerEvents(trustWorker, "trust-queue");
