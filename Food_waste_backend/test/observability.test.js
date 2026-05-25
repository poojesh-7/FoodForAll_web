const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getPrometheusMetrics,
  recordHttpRequest,
  recordPaymentEvent,
  recordQueueJob,
  recordReservationCreated,
  resetMetricsForTest,
} = require("../shared/services/metrics.service");
const {
  contextFromJob,
  contextFromRequest,
  runWithContext,
} = require("../shared/utils/requestContext");
const {
  closeQueueRuntime,
  registerQueue,
} = require("../shared/utils/queueRuntime");

test("metrics service emits Prometheus counters and histograms", () => {
  resetMetricsForTest();

  recordHttpRequest({
    method: "post",
    route: "/api/v1/reservations",
    statusCode: 201,
    durationMs: 42,
  });
  recordQueueJob({
    queueName: "payment-queue",
    event: "completed",
    durationMs: 120,
    waitMs: 15,
  });
  recordPaymentEvent({
    eventName: "cashfree_webhook_processed",
    severity: "info",
    status: "PAID",
  });
  recordReservationCreated({
    pickupType: "self_pickup",
    paymentStatus: "pending",
    source: "user_reservation",
  });

  const metrics = getPrometheusMetrics();

  assert.match(metrics, /food_rescue_http_requests_total/);
  assert.match(metrics, /route="\/api\/v1\/reservations"/);
  assert.match(metrics, /food_rescue_queue_jobs_total/);
  assert.match(metrics, /queue="payment-queue"/);
  assert.match(metrics, /food_rescue_payment_events_total/);
  assert.match(metrics, /event="cashfree_webhook_processed"/);
  assert.match(metrics, /food_rescue_reservations_created_total/);
});

test("request and job contexts preserve request and correlation IDs", () => {
  const requestContext = contextFromRequest({
    headers: {
      "x-request-id": "req-123",
      "x-correlation-id": "corr-123",
    },
    user: { id: "user-123", role: "user" },
    params: { id: "reservation-123" },
    body: { paymentSessionId: "payment-session-123" },
    query: {},
  });

  assert.equal(requestContext.requestId, "req-123");
  assert.equal(requestContext.correlationId, "corr-123");
  assert.equal(requestContext.userId, "user-123");
  assert.equal(requestContext.reservationId, "reservation-123");
  assert.equal(requestContext.paymentSessionId, "payment-session-123");

  const jobContext = contextFromJob(
    {
      id: "job-1",
      data: {
        requestId: "req-123",
        correlationId: "corr-123",
        reservationId: "reservation-123",
      },
    },
    "payment-worker"
  );

  assert.equal(jobContext.requestId, "req-123");
  assert.equal(jobContext.correlationId, "corr-123");
  assert.equal(jobContext.queueJobId, "job-1");
  assert.equal(jobContext.workerName, "payment-worker");
});

test("registered queues attach trace context to jobs", async () => {
  let capturedJob;
  const queue = {
    name: `observability-test-${Date.now()}`,
    add: async (name, data, opts) => {
      capturedJob = { name, data, opts };
      return capturedJob;
    },
    on: () => {},
    close: async () => {},
  };

  registerQueue(queue);
  await runWithContext(
    {
      requestId: "req-queue-1",
      correlationId: "corr-queue-1",
      userId: "user-queue-1",
      role: "user",
      reservationId: "reservation-queue-1",
      paymentSessionId: "payment-session-queue-1",
    },
    () => queue.add("payment-timeout", { orderId: "order-1" }, { jobId: "job-1" })
  );

  assert.equal(capturedJob.data.requestId, "req-queue-1");
  assert.equal(capturedJob.data.correlationId, "corr-queue-1");
  assert.equal(capturedJob.data.userId, "user-queue-1");
  assert.equal(capturedJob.data.role, "user");
  assert.equal(capturedJob.data.reservationId, "reservation-queue-1");
  assert.equal(capturedJob.data.paymentSessionId, "payment-session-queue-1");
  assert.equal(capturedJob.data.orderId, "order-1");

  await closeQueueRuntime({ timeoutMs: 1000 });
});
