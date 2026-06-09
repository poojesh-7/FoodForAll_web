const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertProfilePhoneMatchesAuthenticatedUser,
} = require("../shared/services/authProfile.service");

test("profile completion accepts the authenticated phone across normal formats", () => {
  const normalized = assertProfilePhoneMatchesAuthenticatedUser({
    submittedPhone: "9876543210",
    authenticatedPhone: "+919876543210",
  });

  assert.equal(normalized, "+919876543210");
});

test("profile completion rejects a different submitted phone", () => {
  assert.throws(
    () =>
      assertProfilePhoneMatchesAuthenticatedUser({
        submittedPhone: "+919876543210",
        authenticatedPhone: "+919876543211",
      }),
    (err) => {
      assert.equal(err.reason, "profile_phone_mismatch");
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});
