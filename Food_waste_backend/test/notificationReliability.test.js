const assert = require("node:assert/strict");
const test = require("node:test");

const SERVICE_PATH = require.resolve("../shared/services/notification.service");
const DB_PATH = require.resolve("../shared/config/db");
const REDIS_PATH = require.resolve("../shared/config/redis");
const PUSH_PATH = require.resolve("../shared/services/push.service");

function setCacheExport(path, exports) {
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports,
  };
}

function restoreCache(path, cached) {
  if (cached) {
    require.cache[path] = cached;
  } else {
    delete require.cache[path];
  }
}

test("notifyUser persists notifications with queue idempotency before delivery", async () => {
  const original = {
    service: require.cache[SERVICE_PATH],
    db: require.cache[DB_PATH],
    redis: require.cache[REDIS_PATH],
    push: require.cache[PUSH_PATH],
  };
  const queries = [];
  const publishes = [];
  const pushes = [];

  setCacheExport(DB_PATH, {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            user_id: params[0],
            type: params[1],
            title: params[2],
            message: params[3],
            idempotency_key: params[4],
            created_at: "2026-06-10T08:00:00.000Z",
          },
        ],
      };
    },
  });
  setCacheExport(REDIS_PATH, {
    async publish(channel, payload) {
      publishes.push({ channel, payload: JSON.parse(payload) });
    },
  });
  setCacheExport(PUSH_PATH, {
    async sendPush(userId, type, title, message) {
      pushes.push({ userId, type, title, message });
    },
  });
  delete require.cache[SERVICE_PATH];

  try {
    const { notifyUser } = require(SERVICE_PATH);
    const row = await notifyUser(
      "22222222-2222-4222-8222-222222222222",
      "queue_test",
      "Queue Test",
      "Retry-safe notification",
      { reservationId: "reservation-1" },
      { idempotencyKey: "notification-queue:42" }
    );

    assert.equal(row.idempotency_key, "notification-queue:42");
    assert.match(queries[0].sql, /ON CONFLICT \(idempotency_key\)/);
    assert.deepEqual(queries[0].params, [
      "22222222-2222-4222-8222-222222222222",
      "queue_test",
      "Queue Test",
      "Retry-safe notification",
      "notification-queue:42",
    ]);
    assert.equal(publishes[0].channel, "socket_events");
    assert.equal(publishes[0].payload.room, "user:22222222-2222-4222-8222-222222222222");
    assert.equal(publishes[0].payload.data.idempotency_key, "notification-queue:42");
    assert.equal(pushes.length, 1);
  } finally {
    restoreCache(SERVICE_PATH, original.service);
    restoreCache(DB_PATH, original.db);
    restoreCache(REDIS_PATH, original.redis);
    restoreCache(PUSH_PATH, original.push);
  }
});
