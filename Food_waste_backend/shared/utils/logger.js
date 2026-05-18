const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|otp|pickup_code|receive_code|verification_code|session|signature|payment_session|payment_session_id|payment_details|card|cvv|upi|bank|payload)/i;

const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 5;
const {
  EMPTY_CONTEXT,
  getContext,
  normalizeContext,
} = require("./requestContext");

function isProduction() {
  return process.env.NODE_ENV === "production";
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

function buildEntry(level, message, meta) {
  const normalizedMeta = redact(meta || {});
  const context = normalizeContext({
    ...getContext(),
    ...(normalizedMeta.context || {}),
    requestId: normalizedMeta.requestId ?? getContext().requestId,
    userId: normalizedMeta.userId ?? getContext().userId,
    role: normalizedMeta.role ?? getContext().role,
    reservationId: normalizedMeta.reservationId ?? getContext().reservationId,
    paymentSessionId:
      normalizedMeta.paymentSessionId ?? getContext().paymentSessionId,
    queueJobId: normalizedMeta.queueJobId ?? getContext().queueJobId,
    workerName: normalizedMeta.workerName ?? getContext().workerName,
  });

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    ...EMPTY_CONTEXT,
    ...context,
    ...normalizedMeta,
  };

  delete entry.context;
  return entry;
}

function write(level, message, meta) {
  const entry = buildEntry(level, message, meta);

  if (isProduction()) {
    const line = JSON.stringify(entry);
    if (level === "error") return console.error(line);
    if (level === "warn") return console.warn(line);
    return console.log(line);
  }

  const metaForDev = { ...entry };
  delete metaForDev.level;
  delete metaForDev.message;
  delete metaForDev.timestamp;
  delete metaForDev.environment;

  const hasMeta = Object.keys(metaForDev).length > 0;
  const prefix = `[${entry.timestamp}] ${level.toUpperCase()}: ${message}`;

  if (level === "error") {
    return hasMeta ? console.error(prefix, metaForDev) : console.error(prefix);
  }

  if (level === "warn") {
    return hasMeta ? console.warn(prefix, metaForDev) : console.warn(prefix);
  }

  return hasMeta ? console.log(prefix, metaForDev) : console.log(prefix);
}

module.exports = {
  debug: (message, meta) => {
    if (!isProduction()) write("debug", message, meta);
  },
  error: (message, meta) => write("error", message, meta),
  info: (message, meta) => write("info", message, meta),
  payment: (message, meta) => write("info", message, { eventCategory: "payment", ...meta }),
  queue: (message, meta) => write("info", message, { eventCategory: "queue", ...meta }),
  redact,
  security: (message, meta) => write("warn", message, { eventCategory: "security", ...meta }),
  serializeError,
  warn: (message, meta) => write("warn", message, meta),
  withContext: (context) => ({
    debug: (message, meta) => {
      if (!isProduction()) write("debug", message, { ...meta, context });
    },
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
