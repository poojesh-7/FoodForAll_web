const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const financialReconciliationQueue = require("../queues/financialReconciliation.queue");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { jobOptions, workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const {
  runFinancialReconciliation,
} = require("../shared/services/financialReconciliation.service");

const FINANCIAL_RECONCILIATION_INTERVAL_MS = Number(
  process.env.FINANCIAL_RECONCILIATION_INTERVAL_MS || 30 * 60 * 1000
);

logger.info("Financial reconciliation worker started");

financialReconciliationQueue
  .add(
    "financial-reconciliation-sweep",
    {},
    jobOptions("critical", {
      jobId: "financial-reconciliation-sweep",
      repeat: { every: FINANCIAL_RECONCILIATION_INTERVAL_MS },
      removeOnComplete: { age: 60 * 60, count: 48 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
    })
  )
  .catch((err) => {
    logger.warn("Financial reconciliation sweep scheduling failed", { err });
  });

const financialReconciliationWorker = new Worker(
  "financial-reconciliation-queue",
  withWorkerBoundary("financial-reconciliation-worker", async (job) => {
    if (job.name !== "financial-reconciliation-sweep") {
      logger.warn("Financial reconciliation job ignored", {
        jobId: job.id,
        jobName: job.name,
      });
      return;
    }

    const results = await runFinancialReconciliation({
      limit: job.data?.limit,
    });

    logger.info("Financial reconciliation sweep completed", {
      jobId: job.id,
      repaired: results.filter((result) => result.status === "repaired").length,
      failed: results.filter((result) => result.status === "failed").length,
      total: results.length,
    });
  }),
  workerOptions(connection)
);

registerWorkerEvents(
  financialReconciliationWorker,
  "financial-reconciliation-worker"
);
