const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertAdmin,
  assertPaymentAuthorization,
  assertVerifiedNGO,
  assertVerifiedProvider,
  assertVerifiedUser,
  assertVerifiedVolunteer,
} = require("../shared/services/authorization.service");

function clientWithRows(rowSets) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const rows = rowSets.shift() || [];
      return { rows, rowCount: rows.length };
    },
  };
}

function expectAuthorizationFailure(fn, reason) {
  return assert.rejects(fn, (err) => {
    assert.equal(err.reason, reason);
    assert.equal(err.statusCode, 403);
    return true;
  });
}

test("verified provider gate accepts approved providers", async () => {
  const client = clientWithRows([
    [{ id: "user-1", role: "provider", is_verified: false }],
    [{ id: "restaurant-1", is_verified: true }],
  ]);

  const context = await assertVerifiedProvider({ client, userId: "user-1" });

  assert.equal(context.role, "provider");
  assert.equal(context.provider.id, "restaurant-1");
});

test("verified NGO gate accepts approved NGOs regardless of users.is_verified", async () => {
  const client = clientWithRows([
    [{ id: "user-1", role: "ngo", is_verified: false }],
    [{ id: "ngo-1", is_verified: true }],
  ]);

  const context = await assertVerifiedNGO({ client, userId: "user-1" });

  assert.equal(context.role, "ngo");
  assert.equal(context.ngo.id, "ngo-1");
});

test("verified NGO gate rejects unapproved NGOs", async () => {
  const client = clientWithRows([
    [{ id: "user-1", role: "ngo", is_verified: true }],
    [{ id: "ngo-1", is_verified: false }],
  ]);

  await expectAuthorizationFailure(
    () => assertVerifiedNGO({ client, userId: "user-1" }),
    "ngo_not_approved"
  );
});

test("verified provider gate rejects unverified providers", async () => {
  const client = clientWithRows([
    [{ id: "user-1", role: "provider", is_verified: false }],
    [{ id: "restaurant-1", is_verified: false }],
  ]);

  await expectAuthorizationFailure(
    () => assertVerifiedProvider({ client, userId: "user-1" }),
    "provider_not_verified"
  );
});

test("normal users pass without users.is_verified", async () => {
  const client = clientWithRows([
    [{ id: "user-1", role: "user", is_verified: false }],
  ]);

  const context = await assertVerifiedUser({ client, userId: "user-1" });

  assert.equal(context.role, "user");
});

test("volunteers pass without users.is_verified", async () => {
  const client = clientWithRows([
    [{ id: "user-1", role: "volunteer", is_verified: false }],
  ]);

  const context = await assertVerifiedVolunteer({ client, userId: "user-1" });

  assert.equal(context.role, "volunteer");
});

test("verified NGO gate rejects users who only claim a non-NGO role", async () => {
  const client = clientWithRows([
    [{ id: "user-1", role: "user", is_verified: false }],
  ]);

  await expectAuthorizationFailure(
    () => assertVerifiedNGO({ client, userId: "user-1" }),
    "missing_ngo_role"
  );
});

test("verified user gate rejects banned users", async () => {
  const client = clientWithRows([
    [{
      id: "user-1",
      role: "user",
      is_verified: true,
      banned_until: new Date(Date.now() + 60_000).toISOString(),
    }],
  ]);

  await expectAuthorizationFailure(
    () => assertVerifiedUser({ client, userId: "user-1" }),
    "account_banned"
  );
});

test("admin gate requires verified admin account", async () => {
  const client = clientWithRows([
    [{ id: "admin-1", role: "admin", is_verified: true }],
  ]);

  const context = await assertAdmin({ client, userId: "admin-1" });

  assert.equal(context.role, "admin");
});

test("payment authorization rejects middleware bypass ownership mismatch", () => {
  assert.throws(
    () =>
      assertPaymentAuthorization({
        user: { id: "user-1", role: "user" },
        reservations: [{ id: "reservation-1", user_id: "user-2", pickup_type: "self_pickup" }],
      }),
    (err) => {
      assert.equal(err.reason, "payment_owner_mismatch");
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});

test("payment authorization rejects role-flow mismatches", () => {
  assert.throws(
    () =>
      assertPaymentAuthorization({
        user: { id: "user-1", role: "user" },
        reservations: [{ id: "reservation-1", user_id: "user-1", pickup_type: "ngo" }],
      }),
    (err) => {
      assert.equal(err.reason, "invalid_user_payment");
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});
