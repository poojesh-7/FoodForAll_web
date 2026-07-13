const assert = require("node:assert/strict");
const test = require("node:test");

const SERVICE_PATH = require.resolve("../shared/services/notification.service");
const DB_PATH = require.resolve("../shared/config/db");
const REALTIME_PATH = require.resolve("../shared/services/realtime.service");
const PUSH_PATH = require.resolve("../shared/services/push.service");
const WEBPUSH_PATH = require.resolve("../shared/services/webPush.service");

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
    realtime: require.cache[REALTIME_PATH],
    push: require.cache[PUSH_PATH],
    webpush: require.cache[WEBPUSH_PATH],
  };
  const queries = [];
  const socketEvents = [];
  const pushes = [];
  const browserPushEvents = [];

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
  setCacheExport(REALTIME_PATH, {
    async publishSocketEvent(room, event, data, options) {
      socketEvents.push({ room, event, data, options });
    },
  });
  setCacheExport(PUSH_PATH, {
    async sendPush(userId, type, title, message) {
      pushes.push({ userId, type, title, message });
    },
  });
  setCacheExport(WEBPUSH_PATH, {
    async sendBrowserPushNotification(notification, data = {}) {
      browserPushEvents.push({ notification, data });
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
    assert.deepEqual(socketEvents[0], {
      room: "user:22222222-2222-4222-8222-222222222222",
      event: "notification",
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "22222222-2222-4222-8222-222222222222",
        type: "queue_test",
        title: "Queue Test",
        message: "Retry-safe notification",
        idempotency_key: "notification-queue:42",
        created_at: "2026-06-10T08:00:00.000Z",
        reservationId: "reservation-1",
      },
      options: { throwOnError: true },
    });
    assert.equal(pushes.length, 1);
    assert.deepEqual(browserPushEvents, [
      {
        notification: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "22222222-2222-4222-8222-222222222222",
          type: "queue_test",
          title: "Queue Test",
          message: "Retry-safe notification",
          idempotency_key: "notification-queue:42",
          created_at: "2026-06-10T08:00:00.000Z",
        },
        data: { reservationId: "reservation-1" },
      },
    ]);
  } finally {
    restoreCache(SERVICE_PATH, original.service);
    restoreCache(DB_PATH, original.db);
    restoreCache(REALTIME_PATH, original.realtime);
    restoreCache(PUSH_PATH, original.push);
    restoreCache(WEBPUSH_PATH, original.webpush);
  }
});
