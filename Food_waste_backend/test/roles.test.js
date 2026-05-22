const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateOnboardingRoleSelection,
  validateSelfServiceRole,
} = require("../utils/roles");

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

test("onboarding role selection allows NGO and provider from normal accounts", () => {
  assert.deepEqual(validateOnboardingRoleSelection("ngo", "user"), {
    allowed: true,
    onboarding: true,
    privileged: true,
    reason: null,
    role: "ngo",
  });

  assert.deepEqual(validateOnboardingRoleSelection(" provider ", "volunteer"), {
    allowed: true,
    onboarding: true,
    privileged: true,
    reason: null,
    role: "provider",
  });
});

test("onboarding role selection blocks admin and privileged cross-switching", () => {
  assert.deepEqual(validateOnboardingRoleSelection("admin", "user"), {
    allowed: false,
    onboarding: false,
    privileged: true,
    reason: "privileged_role_forbidden",
    role: "admin",
  });

  assert.deepEqual(validateOnboardingRoleSelection("provider", "ngo"), {
    allowed: false,
    onboarding: true,
    privileged: true,
    reason: "privileged_role_switch_forbidden",
    role: "provider",
  });
});
