const assert = require("node:assert/strict");
const test = require("node:test");

const {
  heartbeatAgeMs,
  heartbeatStatus,
} = require("../shared/utils/heartbeatStatus");

test("heartbeat age prefers database-computed seconds over parsed timestamp", () => {
  const now = Date.UTC(2026, 5, 10, 10, 43, 0);
  const heartbeat = {
    last_seen_at: new Date(Date.UTC(2026, 5, 10, 5, 12, 50)),
    seconds_since_seen: 9,
  };

  assert.equal(heartbeatAgeMs(heartbeat, now), 9000);
  assert.equal(heartbeatStatus(heartbeat, 90_000, now), "ok");
});

test("heartbeat status falls back to timestamp parsing when database age is absent", () => {
  const now = Date.UTC(2026, 5, 10, 10, 43, 0);

  assert.equal(
    heartbeatStatus(
      { last_seen_at: new Date(now - 91_000) },
      90_000,
      now
    ),
    "stale"
  );
});
