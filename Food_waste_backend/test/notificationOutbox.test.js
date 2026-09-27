const assert = require("node:assert/strict");
const test = require("node:test");

const {
  enqueueNotificationOutbox,
  processNotificationOutboxBatch,
} = require("../shared/services/notificationOutbox.service");

const OUTBOX_ROW = {
  id: "22222222-2222-4222-8222-222222222222",
  idempotency_key: "pickup-timeout:reservation-1:volunteer-1",
  user_id: "11111111-1111-4111-8111-111111111111",
  notification_type: "task_failed",
  title: "Task Cancelled",
  message: "Pickup task expired.",
  data: { reservation_id: "reservation-1" },
  socket_event: "task:failed",
  socket_data: { reservation_id: "reservation-1" },
  attempts: 1,
};

test("enqueueNotificationOutbox stores an idempotent intent through the caller transaction", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: OUTBOX_ROW.id }] };
    },
  };

  const result = await enqueueNotificationOutbox(client, {
    idempotencyKey: OUTBOX_ROW.idempotency_key,
    userId: OUTBOX_ROW.user_id,
    type: OUTBOX_ROW.notification_type,
    title: OUTBOX_ROW.title,
    message: OUTBOX_ROW.message,
    data: OUTBOX_ROW.data,
    socketEvent: OUTBOX_ROW.socket_event,
    socketData: OUTBOX_ROW.socket_data,
  });

  assert.deepEqual(result, { id: OUTBOX_ROW.id });
  assert.match(calls[0].sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.equal(calls[0].params[0], OUTBOX_ROW.idempotency_key);
  assert.equal(JSON.parse(calls[0].params[5]).reservation_id, "reservation-1");
});

test("outbox batch delivers notifications and marks claimed intents sent", async () => {
  const calls = [];
  const delivered = [];
  const socketEvents = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return sql.includes("WITH claimable") ? { rows: [OUTBOX_ROW] } : { rows: [] };
    },
  };

  const summary = await processNotificationOutboxBatch({
    db,
    notifyUser: async (...args) => delivered.push(args),
    publishSocketEvent: async (...args) => socketEvents.push(args),
  });

  assert.deepEqual(summary, { sent: 1, retried: 0, failed: 0 });
  assert.equal(delivered[0][0], OUTBOX_ROW.user_id);
  assert.equal(delivered[0][5].idempotencyKey, OUTBOX_ROW.idempotency_key);
  assert.deepEqual(socketEvents, [
    [`user:${OUTBOX_ROW.user_id}`, "task:failed", OUTBOX_ROW.socket_data],
  ]);
  assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[2].sql, /SET status='sent'/);
});

test("failed outbox delivery is returned to pending with retry scheduling", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("WITH claimable")) return { rows: [OUTBOX_ROW] };
      if (sql.includes("CASE WHEN attempts")) {
        return { rows: [{ status: "pending", attempts: OUTBOX_ROW.attempts }] };
      }
      return { rows: [] };
    },
  };

  const summary = await processNotificationOutboxBatch({
    db,
    notifyUser: async () => {
      throw new Error("temporary socket failure");
    },
    publishSocketEvent: async () => assert.fail("socket event should not be published"),
  });

  assert.deepEqual(summary, { sent: 0, retried: 1, failed: 0 });
  assert.match(calls[2].sql, /available_at=NOW\(\) \+ LEAST/);
  assert.match(calls[2].sql, /status=CASE WHEN attempts >= \$2 THEN 'failed' ELSE 'pending' END/);
});

test("expired final-attempt leases are failed and alerted", async () => {
  const calls = [];
  const alerts = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SET status='failed'")) {
        return { rows: [{ ...OUTBOX_ROW, attempts: 8 }] };
      }
      return { rows: [] };
    },
  };

  const summary = await processNotificationOutboxBatch({
    db,
    notifyUser: async () => assert.fail("no notification should be claimed"),
    publishSocketEvent: async () => assert.fail("no socket event should be published"),
    recordAlert: async (alert) => alerts.push(alert),
  });

  assert.deepEqual(summary, { sent: 0, retried: 0, failed: 1 });
  assert.match(calls[0].sql, /locked_until <= NOW\(\) AND attempts >= \$1/);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].metadata.outboxId, OUTBOX_ROW.id);
});