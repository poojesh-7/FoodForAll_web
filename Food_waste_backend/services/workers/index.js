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
require("../../shared/config/db");
require("../../shared/config/redis");

registerProcessErrorHandlers("workers");

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
