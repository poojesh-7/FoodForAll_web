const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ensurePhoneAvailable,
  getIdentityConflictMessage,
  isIdentityUniqueViolation,
} = require("../utils/identity");

test("ensurePhoneAvailable allows the same user to keep their phone", async () => {
  const pool = {
    async query() {
      return {
        rows: [{ id: "user-1", phone: "+919876543210" }],
      };
    },
  };

  await assert.doesNotReject(() =>
    ensurePhoneAvailable(pool, "+919876543210", "user-1")
  );
});

test("ensurePhoneAvailable rejects duplicate phone on another user", async () => {
  const pool = {
    async query() {
      return {
        rows: [{ id: "user-2", phone: "+919876543210" }],
      };
    },
  };

  await assert.rejects(
    () => ensurePhoneAvailable(pool, "+919876543210", "user-1"),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Phone number already registered/);
      return true;
    }
  );
});

test("identity unique violation recognizes google identity conflicts", () => {
  const err = {
    code: "23505",
    constraint: "users_google_id_unique_idx",
    detail: "Key (google_id)=(abc) already exists.",
  };

  assert.equal(isIdentityUniqueViolation(err), true);
  assert.equal(getIdentityConflictMessage(err), "Google account already linked");
});
