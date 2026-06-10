const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DELAYED_CLEANUP_CANDIDATE_MS,
  DELAYED_OVERDUE_MS,
  classifyDelayedJob,
} = require("../shared/utils/queueJobClassification");

test("classifies expected future delayed jobs as valid", () => {
  const now = Date.UTC(2026, 5, 10, 8, 0, 0);
  const result = classifyDelayedJob(
    "expiry-queue",
    {
      name: "expire-food",
      timestamp: now,
      delay: 30 * 60 * 1000,
      attemptsMade: 0,
      opts: { attempts: 5 },
    },
    now
  );

  assert.equal(result.delayed_classification, "valid");
  assert.equal(result.expected_delay, true);
});

test("classifies BullMQ backoff delays as retry pending", () => {
  const now = Date.UTC(2026, 5, 10, 8, 0, 0);
  const result = classifyDelayedJob(
    "notification-queue",
    {
      name: "notify-user",
      timestamp: now - 1000,
      delay: 60 * 1000,
      attemptsMade: 1,
      opts: { attempts: 3 },
    },
    now
  );

  assert.equal(result.delayed_classification, "retry_pending");
  assert.equal(result.expected_delay, true);
});

test("classifies overdue delayed jobs as stale before cleanup threshold", () => {
  const now = Date.UTC(2026, 5, 10, 8, 0, 0);
  const result = classifyDelayedJob(
    "pickup-queue",
    {
      name: "pickup-timeout",
      timestamp: now - DELAYED_OVERDUE_MS - 10_000,
      delay: 1,
      attemptsMade: 0,
      opts: { attempts: 5 },
    },
    now
  );

  assert.equal(result.delayed_classification, "stale");
  assert.ok(result.overdue_ms > DELAYED_OVERDUE_MS);
});

test("classifies very old overdue delayed jobs as cleanup candidates", () => {
  const now = Date.UTC(2026, 5, 10, 8, 0, 0);
  const result = classifyDelayedJob(
    "delivery-queue",
    {
      name: "delivery-timeout",
      timestamp: now - DELAYED_CLEANUP_CANDIDATE_MS - 10_000,
      delay: 1,
      attemptsMade: 0,
      opts: { attempts: 5 },
    },
    now
  );

  assert.equal(result.delayed_classification, "cleanup_candidate");
  assert.ok(result.overdue_ms > DELAYED_CLEANUP_CANDIDATE_MS);
});
