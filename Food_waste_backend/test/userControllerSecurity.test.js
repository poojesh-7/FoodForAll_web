const assert = require("node:assert/strict");
const test = require("node:test");

const pool = require("../shared/config/db");
const userCtrl = require("../controllers/user.controller");

const originalQuery = pool.query;

function createRes() {
  return {
    statusCode: 200,
    body: null,
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

test.afterEach(() => {
  pool.query = originalQuery;
});

test("getUser blocks cross-user profile reads before querying profile data", async () => {
  let queried = false;
  pool.query = async () => {
    queried = true;
    return { rows: [] };
  };

  const res = createRes();
  await userCtrl.getUser(
    {
      params: { id: "22222222-2222-4222-8222-222222222222" },
      user: { id: "11111111-1111-4111-8111-111111111111", role: "user" },
      originalUrl: "/api/v1/users/22222222-2222-4222-8222-222222222222",
      ip: "127.0.0.1",
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Unauthorized" });
  assert.equal(queried, false);
});
