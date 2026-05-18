const logger = require("../utils/logger");
const { categorizeError } = require("../utils/errors");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");

async function captureError(err, context = {}) {
  const category = context.category || categorizeError(err);
  const severity = context.severity || (category === "validation" ? "warning" : "error");
  const eventName = context.eventName || `${category}_error`;
  const metadata = {
    ...context,
    errorName: err?.name,
    message: err?.message || String(err || "unknown error"),
    statusCode: err?.statusCode || err?.status,
    code: err?.code,
  };

  logger.error("Error captured", { err, errorCategory: category, ...context });

  await recordOperationalEvent({
    category,
    severity,
    eventName,
    metadata,
  });

  if (severity === "error" || context.alert) {
    await recordAlert({
      alertKey: context.alertKey || `${category}:${eventName}`,
      category,
      severity,
      message: context.alertMessage || metadata.message,
      metadata,
    });
  }
}

function registerProcessErrorHandlers(processName) {
  process.on("uncaughtException", (err) => {
    captureError(err, {
      category: "system",
      eventName: "uncaught_exception",
      processName,
      alert: true,
      alertKey: `${processName}:uncaught_exception`,
    }).finally(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    void captureError(err, {
      category: "system",
      eventName: "unhandled_rejection",
      processName,
      alert: true,
      alertKey: `${processName}:unhandled_rejection`,
    });
  });
}

module.exports = {
  captureError,
  registerProcessErrorHandlers,
};
