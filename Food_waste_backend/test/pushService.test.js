const assert = require("node:assert/strict");
const test = require("node:test");

const PUSH_PATH = require.resolve("../shared/services/push.service");
const FIREBASE_PATH = require.resolve("../shared/config/firebase");
const DB_PATH = require.resolve("../shared/config/db");

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

test("FCM push uses notification ID as a stable Android replacement tag", async () => {
  const original = {
    push: require.cache[PUSH_PATH],
    firebase: require.cache[FIREBASE_PATH],
    db: require.cache[DB_PATH],
  };
  const messages = [];
  const notificationId = "11111111-1111-4111-8111-111111111111";

  setCacheExport(FIREBASE_PATH, {
    messaging: () => ({
      async send(message) {
        messages.push(message);
      },
    }),
  });
  setCacheExport(DB_PATH, {
    async query() {
      return { rows: [{ fcm_token: "test-token" }] };
    },
  });
  delete require.cache[PUSH_PATH];

  try {
    const { sendPush } = require(PUSH_PATH);
    await sendPush("user-1", "task_failed", "Task Failed", "Pickup expired", notificationId);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].android.notification.tag, notificationId);
    assert.equal(messages[0].data.notification_id, notificationId);
  } finally {
    restoreCache(PUSH_PATH, original.push);
    restoreCache(FIREBASE_PATH, original.firebase);
    restoreCache(DB_PATH, original.db);
  }
});