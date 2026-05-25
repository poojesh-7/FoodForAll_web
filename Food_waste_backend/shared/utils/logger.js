const pino = require("pino");
const {
  EMPTY_CONTEXT,
  getContext,
  normalizeContext,
} = require("./requestContext");

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|otp|pickup_code|receive_code|verification_code|session|signature|payment_session|payment_session_id|payment_details|card|cvv|upi|bank|payload)/i;

const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 5;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

let baseLogger;

function getBaseLogger() {
  if (!baseLogger) {
    baseLogger = pino({
      base: {
        service: process.env.SERVICE_NAME || "food_waste_backend",
      },
      level: process.env.LOG_LEVEL || (isProduction() ? "info" : "debug"),
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  return baseLogger;
}

function redact(value, depth = 0) {
  if (depth > MAX_DEPTH) return "[MaxDepth]";
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const output = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[Redacted]";
      } else {
        output[key] = redact(nestedValue, depth + 1);
      }
    }

    return output;
  }

  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}...`;
  }

  return value;
}

function serializeError(err) {
  if (!err) return undefined;

  const serialized = {
    name: err.name,
    message: err.message,
    code: err.code,
    statusCode: err.statusCode || err.status,
  };

  if (!isProduction() && err.stack) {
    serialized.stack = err.stack;
  }

  return redact(serialized, 1);
}

function buildFields(meta) {
  const normalizedMeta = redact(meta || {});
  const currentContext = getContext();
  const context = normalizeContext({
    ...currentContext,
    ...(normalizedMeta.context || {}),
    requestId: normalizedMeta.requestId ?? currentContext.requestId,
    correlationId: normalizedMeta.correlationId ?? currentContext.correlationId,
    userId: normalizedMeta.userId ?? currentContext.userId,
    role: normalizedMeta.role ?? currentContext.role,
    reservationId: normalizedMeta.reservationId ?? currentContext.reservationId,
    paymentSessionId:
      normalizedMeta.paymentSessionId ?? currentContext.paymentSessionId,
    queueJobId: normalizedMeta.queueJobId ?? currentContext.queueJobId,
    workerName: normalizedMeta.workerName ?? currentContext.workerName,
  });

  const fields = {
    environment: process.env.NODE_ENV || "development",
    appEnv: process.env.APP_ENV,
    ...EMPTY_CONTEXT,
    ...context,
    ...normalizedMeta,
  };

  delete fields.context;
  return fields;
}

function write(level, message, meta) {
  const logger = getBaseLogger();
  const log = logger[level] ? logger[level].bind(logger) : logger.info.bind(logger);
  log(buildFields(meta), message);
}

module.exports = {
  debug: (message, meta) => write("debug", message, meta),
  error: (message, meta) => write("error", message, meta),
  info: (message, meta) => write("info", message, meta),
  payment: (message, meta) => write("info", message, { eventCategory: "payment", ...meta }),
  queue: (message, meta) => write("info", message, { eventCategory: "queue", ...meta }),
  redact,
  security: (message, meta) => write("warn", message, { eventCategory: "security", ...meta }),
  serializeError,
  warn: (message, meta) => write("warn", message, meta),
  withContext: (context) => ({
    debug: (message, meta) => write("debug", message, { ...meta, context }),
    error: (message, meta) => write("error", message, { ...meta, context }),
    info: (message, meta) => write("info", message, { ...meta, context }),
    payment: (message, meta) =>
      write("info", message, { eventCategory: "payment", ...meta, context }),
    queue: (message, meta) =>
      write("info", message, { eventCategory: "queue", ...meta, context }),
    security: (message, meta) =>
      write("warn", message, { eventCategory: "security", ...meta, context }),
    warn: (message, meta) => write("warn", message, { ...meta, context }),
  }),
};
