const assert = require("node:assert/strict");
const test = require("node:test");

const { validateSelfServiceRole } = require("../utils/roles");

test("self-service role validation allows only user and volunteer", () => {
  assert.deepEqual(validateSelfServiceRole("user"), {
    allowed: true,
    privileged: false,
    role: "user",
  });
  assert.deepEqual(validateSelfServiceRole(" volunteer "), {
    allowed: true,
    privileged: false,
    role: "volunteer",
  });
});

test("self-service role validation blocks provider, ngo, and admin", () => {
  for (const role of ["provider", "ngo", "admin"]) {
    assert.deepEqual(validateSelfServiceRole(role), {
      allowed: false,
      privileged: true,
      role,
    });
  }
});
