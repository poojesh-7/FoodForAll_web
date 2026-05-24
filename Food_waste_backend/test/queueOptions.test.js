const assert = require("node:assert/strict");
const test = require("node:test");

const {
  jobOptions,
  queueOptions,
  workerOptions,
} = require("../shared/utils/queueOptions");

test("critical job options retain failed jobs for inspection", () => {
  const options = jobOptions("critical", { jobId: "critical-job" });

  assert.equal(options.jobId, "critical-job");
  assert.equal(options.attempts, 5);
  assert.equal(options.backoff.type, "exponential");
  assert.ok(options.removeOnFail.age >= 30 * 24 * 60 * 60);
});

test("queue options deep-merge job retention overrides", () => {
  const options = queueOptions("redis", {
    defaultJobOptions: {
      removeOnFail: { count: 42 },
    },
  });

  assert.equal(options.connection, "redis");
  assert.equal(options.defaultJobOptions.removeOnFail.count, 42);
  assert.ok(options.defaultJobOptions.removeOnFail.age > 0);
});

test("worker options include crash recovery settings without job-only options", () => {
  const options = workerOptions("redis", {
    attempts: 99,
    backoff: { type: "exponential", delay: 1 },
    removeOnComplete: { count: 1 },
    lockDuration: 60000,
  });

  assert.equal(options.connection, "redis");
  assert.equal(options.lockDuration, 60000);
  assert.ok(options.stalledInterval > 0);
  assert.ok(options.maxStalledCount > 0);
  assert.equal(options.attempts, undefined);
  assert.equal(options.backoff, undefined);
  assert.equal(options.removeOnComplete, undefined);
});
