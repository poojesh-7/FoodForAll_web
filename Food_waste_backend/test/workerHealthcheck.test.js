const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateRequiredWorkerHeartbeats,
} = require("../shared/utils/workerHealthcheck");

test("worker healthcheck accepts fresh running heartbeats", () => {
  const evaluation = evaluateRequiredWorkerHeartbeats(
    [
      { worker_name: "notification-queue", status: "running", age_ms: 1000 },
      { worker_name: "payment-queue", status: "processing", age_ms: 2000 },
    ],
    {
      requiredWorkerNames: ["notification-queue", "payment-queue"],
      staleMs: 90000,
    }
  );

  assert.equal(evaluation.healthy, true);
  assert.deepEqual(evaluation.failures, []);
});

test("worker healthcheck reports missing required heartbeats", () => {
  const evaluation = evaluateRequiredWorkerHeartbeats([], {
    requiredWorkerNames: ["trust-queue"],
    staleMs: 90000,
  });

  assert.equal(evaluation.healthy, false);
  assert.deepEqual(evaluation.failures, [
    { workerName: "trust-queue", reason: "missing" },
  ]);
});

test("worker healthcheck reports stale and unhealthy statuses", () => {
  const evaluation = evaluateRequiredWorkerHeartbeats(
    [
      { worker_name: "refund-queue", status: "running", age_ms: 120000 },
      { worker_name: "delivery-queue", status: "error", age_ms: 1000 },
    ],
    {
      requiredWorkerNames: ["refund-queue", "delivery-queue"],
      staleMs: 90000,
    }
  );

  assert.equal(evaluation.healthy, false);
  assert.deepEqual(evaluation.failures, [
    {
      workerName: "refund-queue",
      reason: "stale",
      ageMs: 120000,
      staleMs: 90000,
    },
    {
      workerName: "delivery-queue",
      reason: "unhealthy_status",
      status: "error",
    },
  ]);
});
