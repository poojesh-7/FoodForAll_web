const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyReservationLifecycle,
  lifecycleSql,
} = require("../shared/services/reservationLifecycle.service");

test("reservation lifecycle moves failed payment states to history", () => {
  const lifecycle = classifyReservationLifecycle({
    status: "reserved",
    payment_status: "failed",
    task_status: "self_pickup",
  });

  assert.equal(lifecycle.group, "history");
  assert.equal(lifecycle.status, "failed");
});

test("reservation lifecycle keeps only unexpired pending payment holds active", () => {
  const active = classifyReservationLifecycle(
    {
      status: "payment_pending",
      payment_status: "pending",
      payment_expires_at: "2026-01-01T00:10:00.000Z",
    },
    { now: Date.parse("2026-01-01T00:00:00.000Z") }
  );
  const expired = classifyReservationLifecycle(
    {
      status: "payment_pending",
      payment_status: "pending",
      payment_expires_at: "2026-01-01T00:00:00.000Z",
    },
    { now: Date.parse("2026-01-01T00:10:00.000Z") }
  );

  assert.equal(active.group, "active");
  assert.equal(active.status, "payment_pending");
  assert.equal(expired.group, "history");
  assert.equal(expired.status, "expired");
});

test("provider lifecycle SQL evaluates reservation and payment state together", () => {
  const sql = lifecycleSql("r");

  assert.match(sql, /r\.payment_expires_at <= NOW\(\)/);
  assert.match(sql, /r\.status/);
  assert.match(sql, /r\.payment_status/);
  assert.match(sql, /refund_pending/);
  assert.match(sql, /payment_failed/);
});
