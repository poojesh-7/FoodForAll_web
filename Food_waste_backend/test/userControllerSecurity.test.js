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

test("getUser returns persisted address and location fields for the owner", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  let queryText = "";
  let queryParams = null;

  pool.query = async (text, params) => {
    queryText = text;
    queryParams = params;

    return {
      rows: [
        {
          id: userId,
          name: "Asha Kumar",
          phone: "+919876543210",
          email: "asha@example.com",
          role: "user",
          address: "ABC Street, Bangalore",
          latitude: 12.9716,
          longitude: 77.5946,
          profile_image_url: null,
          profile_image_public_id: null,
          profile_image: null,
          created_at: "2026-08-15T00:00:00.000Z",
        },
      ],
    };
  };

  const res = createRes();
  await userCtrl.getUser(
    {
      params: { id: userId },
      user: { id: userId, role: "user" },
      originalUrl: `/api/v1/users/${userId}`,
      ip: "127.0.0.1",
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.address, "ABC Street, Bangalore");
  assert.equal(res.body.latitude, 12.9716);
  assert.equal(res.body.longitude, 77.5946);
  assert.match(queryText, /\baddress\b/);
  assert.match(queryText, /\blatitude\b/);
  assert.match(queryText, /\blongitude\b/);
  assert.deepEqual(queryParams, [userId]);
});
