const assert = require("node:assert/strict");
const test = require("node:test");

const originalEnv = { ...process.env };
const servicePath = require.resolve("../shared/services/twilioVerify.service");

function loadService(env = {}) {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv, env);
  delete require.cache[servicePath];
  return require("../shared/services/twilioVerify.service");
}

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  delete require.cache[servicePath];
});

test("phone OTP is disabled unless AUTH_ENABLE_OTP is explicitly enabled", () => {
  const service = loadService({
    AUTH_ENABLE_OTP: "false",
    TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    TWILIO_AUTH_TOKEN: "twilio-auth-token",
    TWILIO_VERIFY_SERVICE_SID: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  });

  assert.equal(service.isOtpEnabled(), false);
  assert.equal(service.isOtpConfigured(), false);
});

test("phone OTP is configured when the feature flag and Twilio credentials are present", () => {
  const service = loadService({
    AUTH_ENABLE_OTP: "true",
    TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    TWILIO_AUTH_TOKEN: "twilio-auth-token",
    TWILIO_VERIFY_SERVICE_SID: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  });

  assert.equal(service.isOtpEnabled(), true);
  assert.equal(service.isOtpConfigured(), true);
});

test("safe OTP error message covers disabled launch configuration", () => {
  const service = loadService();
  const safeError = service.getSafeTwilioError(
    { code: "otp_not_enabled", statusCode: 503 },
    "Failed to send OTP"
  );

  assert.equal(safeError.status, 503);
  assert.match(safeError.message, /Google login/);
});
