const { validateEnvironment } = require("../../shared/config/env");
validateEnvironment();
const logger = require("../../shared/utils/logger");
require("../../shared/config/db");
require("../../shared/config/redis");


require("../../workers/expiry.worker");
require("../../workers/notification.worker");
require("../../workers/expiryAlert.worker");
require("../../workers/StartDeliveryTimeout.worker");
require("../../workers/StartPickupTimeout.worker")
require("../../workers/paymentTimeout.worker");
require("../../workers/refund.worker");
const ngolocationSync=require("../../workers/ngoLocationSync.worker");
const notificationCleanup=require("../../workers/notificationCleanup.worker");
ngolocationSync();
notificationCleanup();

process.on("uncaughtException", (err) => {
  logger.error("Worker process uncaught exception", { err });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Worker process unhandled promise rejection", {
    err: reason instanceof Error ? reason : new Error(String(reason)),
  });
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
