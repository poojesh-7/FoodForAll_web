const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const paymentQueue = require("../queues/payment.queue");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { jobOptions, workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const {
  reconcileStalePaymentSessions,
  recoverPaymentOrderAttempts,
} = require("../shared/services/paymentReconciliation.service");

const PAYMENT_RECONCILIATION_SWEEP_JOB = "payment-reconciliation-sweep";
const PAYMENT_RECONCILIATION_SCHEDULER_ID = "payment-reconciliation-sweep";
const PAYMENT_RECONCILIATION_SWEEP_MS = Number(
  process.env.PAYMENT_RECONCILIATION_SWEEP_MS || 5 * 60 * 1000
);

logger.info("Payment timeout worker started");

function paymentReconciliationSweepOptions() {
  return jobOptions("critical", {
    removeOnComplete: { age: 60 * 60, count: 24 },
    removeOnFail: { age: 24 * 60 * 60, count: 100 },
  });
}

async function registerPaymentReconciliationScheduler() {
  try {
    logger.info("Registering payment reconciliation scheduler", {
      schedulerId: PAYMENT_RECONCILIATION_SCHEDULER_ID,
      intervalMs: PAYMENT_RECONCILIATION_SWEEP_MS,
    });

    const removedLegacyRepeatable = await paymentQueue.removeRepeatable(
      PAYMENT_RECONCILIATION_SWEEP_JOB,
      { every: PAYMENT_RECONCILIATION_SWEEP_MS },
      PAYMENT_RECONCILIATION_SWEEP_JOB
    );

    if (removedLegacyRepeatable) {
      logger.warn("Removed legacy payment reconciliation repeat job", {
        jobName: PAYMENT_RECONCILIATION_SWEEP_JOB,
        schedulerId: PAYMENT_RECONCILIATION_SCHEDULER_ID,
        removedLegacyRepeatable,
      });
    }

    const scheduledJob = await paymentQueue.upsertJobScheduler(
      PAYMENT_RECONCILIATION_SCHEDULER_ID,
      { every: PAYMENT_RECONCILIATION_SWEEP_MS },
      {
        name: PAYMENT_RECONCILIATION_SWEEP_JOB,
        data: {
          schedulerId: PAYMENT_RECONCILIATION_SCHEDULER_ID,
          repeatExecution: true,
        },
        opts: paymentReconciliationSweepOptions(),
      }
    );

    const [schedulers, repeatableJobs] = await Promise.all([
      paymentQueue.getJobSchedulers(),
      paymentQueue.getRepeatableJobs(),
    ]);

    logger.info("Payment reconciliation scheduler registered", {
      schedulerId: PAYMENT_RECONCILIATION_SCHEDULER_ID,
      intervalMs: PAYMENT_RECONCILIATION_SWEEP_MS,
      nextJobId: scheduledJob?.id,
      nextDelayMs: scheduledJob?.delay,
      schedulers: schedulers
        .filter((scheduler) => scheduler?.key === PAYMENT_RECONCILIATION_SCHEDULER_ID)
        .map((scheduler) => ({
          key: scheduler.key,
          name: scheduler.name,
          every: scheduler.every,
          next: scheduler.next,
        })),
      repeatableJobCount: repeatableJobs.length,
    });
  } catch (err) {
    logger.error("Payment reconciliation scheduler registration failed", {
      err,
      schedulerId: PAYMENT_RECONCILIATION_SCHEDULER_ID,
      intervalMs: PAYMENT_RECONCILIATION_SWEEP_MS,
    });
  }
}

void registerPaymentReconciliationScheduler();

const paymentTimeoutWorker = new Worker(
  "payment-queue",
  withWorkerBoundary("payment-queue", async (job) => {
    const repeatExecution = Boolean(
      job?.data?.repeatExecution || job?.opts?.repeat || job?.repeatJobKey
    );

    logger.info("Payment queue job received", {
      jobId: job.id,
      jobName: job.name,
      repeatExecution,
      schedulerId: job.data?.schedulerId || null,
      attemptsMade: job.attemptsMade,
    });

    if (job.name === PAYMENT_RECONCILIATION_SWEEP_JOB) {
      logger.info("Payment reconciliation sweep started", {
        jobId: job.id,
        repeatExecution,
        schedulerId: job.data?.schedulerId || null,
      });

      try {
        const [results, attemptResults] = await Promise.all([
          reconcileStalePaymentSessions(),
          recoverPaymentOrderAttempts(),
        ]);
        const locallyExpiredReservations = results.reduce(
          (sum, result) => sum + Number(result?.locallyExpiredReservations || 0),
          0
        );
        const changedReservations = results.reduce(
          (sum, result) => sum + Number(result?.changedReservations || 0),
          0
        );

        logger.info("Payment reconciliation sweep completed", {
          jobId: job.id,
          repeatExecution,
          schedulerId: job.data?.schedulerId || null,
          reconciledOrders: results.length,
          changedReservations,
          locallyExpiredReservations,
          recoveredOrderAttempts: attemptResults.length,
        });
      } catch (err) {
        logger.error("Payment reconciliation sweep failed", {
          jobId: job.id,
          repeatExecution,
          schedulerId: job.data?.schedulerId || null,
          err,
          stack: err?.stack,
        });
        throw err;
      }

      return;
    }

    const { reservationIds } = job.data;

    if (!Array.isArray(reservationIds) || reservationIds.length === 0) {
      logger.warn("Payment timeout job ignored without reservation ids", {
        jobId: job.id,
        jobName: job.name,
      });
      return;
    }

    logger.info("Processing reservation timeout job", {
      jobId: job.id,
      reservationIds,
    });

    try {
      const results = await reconcileStalePaymentSessions({ reservationIds });
      const locallyExpiredReservations = results.reduce(
        (sum, result) => sum + Number(result?.locallyExpiredReservations || 0),
        0
      );
      const changedReservations = results.reduce(
        (sum, result) => sum + Number(result?.changedReservations || 0),
        0
      );

      logger.info("Payment timeout reconciliation completed", {
        jobId: job.id,
        reservationCount: reservationIds.length,
        reconciledOrders: results.length,
        changedReservations,
        locallyExpiredReservations,
      });
    } catch (err) {
      logger.error("Payment timeout reconciliation failed", {
        jobId: job.id,
        reservationIds,
        err,
        stack: err?.stack,
      });
      throw err;
    }
  }),
  workerOptions(connection)
);

registerWorkerEvents(paymentTimeoutWorker, "payment-queue");
