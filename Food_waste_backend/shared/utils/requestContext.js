const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const storage = new AsyncLocalStorage();

const CONTEXT_KEYS = [
  "requestId",
  "userId",
  "role",
  "reservationId",
  "paymentSessionId",
  "queueJobId",
  "workerName",
];

const EMPTY_CONTEXT = Object.freeze(
  CONTEXT_KEYS.reduce((context, key) => {
    context[key] = null;
    return context;
  }, {})
);

function compact(value) {
  if (value === undefined || value === "") return null;
  return value;
}

function normalizeContext(context = {}) {
  return {
    ...EMPTY_CONTEXT,
    requestId: compact(context.requestId),
    userId: compact(context.userId),
    role: compact(context.role),
    reservationId: compact(context.reservationId),
    paymentSessionId: compact(context.paymentSessionId),
    queueJobId: compact(context.queueJobId),
    workerName: compact(context.workerName),
  };
}

function createRequestId() {
  return crypto.randomUUID();
}

function getContext() {
  return storage.getStore() || EMPTY_CONTEXT;
}

function runWithContext(context, callback) {
  return storage.run(normalizeContext({ ...getContext(), ...context }), callback);
}

function mergeContext(context = {}) {
  const current = getContext();
  const next = normalizeContext({ ...current, ...context });
  storage.enterWith(next);
  return next;
}

function contextFromRequest(req) {
  const incoming =
    req.headers["x-request-id"] ||
    req.headers["x-correlation-id"] ||
    req.headers["cf-ray"];
  const requestId = Array.isArray(incoming) ? incoming[0] : incoming;

  return normalizeContext({
    requestId: requestId || createRequestId(),
    userId: req.user?.id,
    role: req.user?.role,
    reservationId: req.params?.reservationId || req.params?.id || req.body?.reservationId,
    paymentSessionId:
      req.body?.payment_session_id ||
      req.body?.paymentSessionId ||
      req.query?.payment_session_id,
  });
}

function contextFromJob(job, workerName) {
  const data = job?.data || {};
  return normalizeContext({
    requestId: data.requestId || data.request_id || createRequestId(),
    userId: data.userId || data.user_id,
    role: data.role,
    reservationId:
      data.reservationId ||
      data.reservation_id ||
      (Array.isArray(data.reservationIds) ? data.reservationIds[0] : null),
    paymentSessionId:
      data.paymentSessionId ||
      data.payment_session_id ||
      data.orderId ||
      data.order_id,
    queueJobId: job?.id,
    workerName,
  });
}

module.exports = {
  CONTEXT_KEYS,
  EMPTY_CONTEXT,
  contextFromJob,
  contextFromRequest,
  createRequestId,
  getContext,
  mergeContext,
  normalizeContext,
  runWithContext,
};
