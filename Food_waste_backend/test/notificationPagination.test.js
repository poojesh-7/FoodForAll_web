const assert = require("node:assert/strict");
const test = require("node:test");

const pool = require("../shared/config/db");
const notificationCtrl = require("../controllers/notification.controller");

const originalQuery = pool.query;

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify(row)).toString("base64url");
}

test.afterEach(() => {
  pool.query = originalQuery;
});

test("notifications are returned as a bounded keyset page", async () => {
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return {
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          created_at: "2026-06-09T10:00:00.000Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          created_at: "2026-06-09T09:00:00.000Z",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          created_at: "2026-06-09T08:00:00.000Z",
        },
      ],
    };
  };

  const res = createRes();
  await notificationCtrl.getNotifications(
    {
      query: { limit: "2" },
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.headers["X-Notification-Limit"], "2");
  assert.equal(res.headers["X-Has-More"], "true");
  assert.ok(res.headers["X-Next-Cursor"]);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/);
  assert.match(calls[0].sql, /LIMIT \$2/);
  assert.deepEqual(calls[0].params, [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    3,
  ]);
});

test("notification cursor adds a stable seek predicate", async () => {
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  };

  const cursor = encodeCursor({
    created_at: "2026-06-09T09:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
  });
  const res = createRes();
  await notificationCtrl.getNotifications(
    {
      query: { cursor, limit: "20" },
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    },
    res
  );

  assert.equal(res.headers["X-Has-More"], "false");
  assert.match(calls[0].sql, /created_at < \$2::timestamptz/);
  assert.match(calls[0].sql, /id < \$3::uuid/);
  assert.deepEqual(calls[0].params, [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "2026-06-09T09:00:00.000Z",
    "22222222-2222-4222-8222-222222222222",
    21,
  ]);
});
