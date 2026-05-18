const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const paymentQueue = require("../queues/payment.queue");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const {
  reconcileStalePaymentSessions,
} = require("../shared/services/paymentReconciliation.service");

logger.info("Payment timeout worker started");

paymentQueue
  .add(
    "payment-reconciliation-sweep",
    {},
    {
      jobId: "payment-reconciliation-sweep",
      repeat: { every: 5 * 60 * 1000 },
      removeOnComplete: { age: 60 * 60, count: 24 },
      removeOnFail: { age: 24 * 60 * 60, count: 100 },
    }
  )
  .catch((err) => {
    logger.warn("Payment reconciliation sweep scheduling failed", { err });
  });

const paymentTimeoutWorker = new Worker(
  "payment-queue",
  withWorkerBoundary("payment-queue", async (job) => {
    if (job.name === "payment-reconciliation-sweep") {
      const results = await reconcileStalePaymentSessions();
      logger.info("Payment reconciliation sweep completed", {
        count: results.length,
      });
      return;
    }

    const { reservationIds } = job.data;

    if (!Array.isArray(reservationIds) || reservationIds.length === 0) {
      logger.warn("Payment timeout job ignored without reservation ids", {
        jobId: job.id,
      });
      return;
    }

    const results = await reconcileStalePaymentSessions({ reservationIds });
    logger.info("Payment timeout reconciliation completed", {
      jobId: job.id,
      reservationCount: reservationIds.length,
      reconciledOrders: results.length,
    });
  }),
  workerOptions(connection, {
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
  })
);

registerWorkerEvents(paymentTimeoutWorker, "payment-queue");
