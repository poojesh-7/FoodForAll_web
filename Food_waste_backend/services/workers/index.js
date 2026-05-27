const {
  isProductionLike,
  validateEnvironment,
} = require("../../shared/config/env");
validateEnvironment();
const logger = require("../../shared/utils/logger");
const {
  assertMigrationsCurrent,
} = require("../../shared/config/migrationStatus");
const {
  registerProcessErrorHandlers,
} = require("../../shared/services/errorTracking.service");
const pool = require("../../shared/config/db");
const redis = require("../../shared/config/redis");
const bullmqConnection = require("../../shared/config/bullmq");
const {
  closeQueueRuntime,
  getQueueRuntimeSnapshot,
} = require("../../shared/utils/queueRuntime");

registerProcessErrorHandlers("workers");

let shuttingDown = false;

function withShutdownTimeout(promise, label) {
  const timeoutMs = Number(process.env.WORKER_PROCESS_SHUTDOWN_TIMEOUT_MS || 45000);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function closeRedisClients() {
  if (redis.isOpen) {
    await redis.quit();
  }

  if (bullmqConnection.status !== "end") {
    await bullmqConnection.quit();
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn("Worker process shutting down", {
    signal,
    runtime: getQueueRuntimeSnapshot(),
  });

  try {
    await closeQueueRuntime();
    await withShutdownTimeout(closeRedisClients(), "Redis clients close");
    await withShutdownTimeout(pool.end(), "PostgreSQL pool close");
    logger.info("Worker process shutdown complete", { signal });
    process.exit(0);
  } catch (err) {
    logger.error("Worker process shutdown failed", { signal, err });
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function startWorkers() {
  if (isProductionLike(process.env.APP_ENV)) {
    await assertMigrationsCurrent();
  }

  require("../../workers/expiry.worker");
  require("../../workers/notification.worker");
  require("../../workers/expiryAlert.worker");
  require("../../workers/StartDeliveryTimeout.worker");
  require("../../workers/StartPickupTimeout.worker");
  require("../../workers/paymentTimeout.worker");
  require("../../workers/refund.worker");
  require("../../workers/trust.worker");
  require("../../workers/operationalCleanup.worker");
  const ngolocationSync = require("../../workers/ngoLocationSync.worker");
  const notificationCleanup = require("../../workers/notificationCleanup.worker");
  ngolocationSync();
  notificationCleanup();

  logger.info("Worker process running");
}

startWorkers().catch((err) => {
    logger.error("Worker startup blocked by pending migrations", { err });
    process.exit(1);
});
// const startExpiryWorker = require("../../workers/expiry.worker");
// // const startTaskTimeoutWorker = require("../../workers/taskTimeout.worker");
// const startNotificationCleanupWorker = require("../../workers/notificationCleanup.worker");
// const startExpiryAlertWorker = require("../../workers/expiryAlert.worker");
// const ngoLocationSyncWorker = require("../../workers/ngoLocationSync.worker");
// const StartPickupTimeoutWorker = require("../../workers/StartPickupTimeout.worker");
// const startDeliveryTimeoutWorker = require("../../workers/StartDeliveryTimeout.worker");

// async function startWorkers() {
//   console.log("🚀 Starting workers...");

//   ngoLocationSyncWorker();
//   startExpiryWorker();
//   StartPickupTimeoutWorker();
//   startDeliveryTimeoutWorker();
//   // startTaskTimeoutWorker();
//   startNotificationCleanupWorker();
//   startExpiryAlertWorker();
// }

// startWorkers();
