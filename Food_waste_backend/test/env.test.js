const assert = require("node:assert/strict");
const test = require("node:test");

const originalEnv = { ...process.env };
const envModulePath = require.resolve("../shared/config/env");
const operationalPolicyModulePath = require.resolve(
  "../shared/config/operationalPolicy"
);

function validEnv(overrides = {}) {
  return {
    APP_ENV: "development",
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://user:password@localhost:5432/food_waste",
    REDIS_URL: "redis://localhost:6379",
    JWT_SECRET: "development-secret-with-enough-length",
    FRONTEND_URL: "http://localhost:3000",
    TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    TWILIO_AUTH_TOKEN: "twilio-auth-token",
    TWILIO_VERIFY_SERVICE_SID: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    CASHFREE_APP_ID: "TEST_APP_ID",
    CASHFREE_SECRET_KEY: "cashfree-secret-key",
    CASHFREE_ENV: "sandbox",
    CLOUDINARY_CLOUD_NAME: "cloud",
    CLOUDINARY_API_KEY: "cloudinary-key",
    CLOUDINARY_API_SECRET: "cloudinary-secret",
    ...overrides,
  };
}

function loadEnvModule(env) {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv, env);
  delete require.cache[envModulePath];
  return require("../shared/config/env");
}

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  delete require.cache[envModulePath];
  delete require.cache[operationalPolicyModulePath];
});

test("validateEnvironment accepts explicit development configuration", () => {
  const { validateEnvironment } = loadEnvModule(validEnv({
    FRONTEND_ORIGINS: "http://localhost:3001, http://127.0.0.1:3000/",
  }));

  const env = validateEnvironment();

  assert.equal(env.APP_ENV, "development");
  assert.equal(process.env.FRONTEND_ORIGINS, "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000");
  assert.equal(env.VOLUNTEER_PICKUP_TIMEOUT_MINUTES, 15);
  assert.equal(env.VOLUNTEER_DELIVERY_TIMEOUT_MINUTES, 30);
  assert.equal(env.FOOD_MIN_PICKUP_WINDOW_MINUTES, 30);
  assert.equal(env.FOOD_MIN_NGO_RESCUE_REMAINING_MINUTES, 30);
  assert.equal(env.FOOD_EXPIRY_ALERT_LEAD_MINUTES, 30);
  assert.equal(env.SELF_PICKUP_CANCELLATION_CUTOFF_MINUTES, 20);
  assert.equal(env.PAYMENT_HOLD_TIMEOUT_MINUTES, 10);
  assert.equal(process.env.PAYMENT_HOLD_TIMEOUT_MINUTES, "10");
});

test("validateEnvironment accepts operational policy overrides", () => {
  const { validateEnvironment } = loadEnvModule(validEnv({
    VOLUNTEER_PICKUP_TIMEOUT_MINUTES: "16",
    VOLUNTEER_DELIVERY_TIMEOUT_MINUTES: "31",
    FOOD_MIN_PICKUP_WINDOW_MINUTES: "32",
    FOOD_MIN_NGO_RESCUE_REMAINING_MINUTES: "33",
    FOOD_EXPIRY_ALERT_LEAD_MINUTES: "34",
    SELF_PICKUP_CANCELLATION_CUTOFF_MINUTES: "21",
    PAYMENT_HOLD_TIMEOUT_MINUTES: "11",
  }));

  const env = validateEnvironment();

  assert.equal(env.VOLUNTEER_PICKUP_TIMEOUT_MINUTES, 16);
  assert.equal(env.VOLUNTEER_DELIVERY_TIMEOUT_MINUTES, 31);
  assert.equal(env.FOOD_MIN_PICKUP_WINDOW_MINUTES, 32);
  assert.equal(env.FOOD_MIN_NGO_RESCUE_REMAINING_MINUTES, 33);
  assert.equal(env.FOOD_EXPIRY_ALERT_LEAD_MINUTES, 34);
  assert.equal(env.SELF_PICKUP_CANCELLATION_CUTOFF_MINUTES, 21);
  assert.equal(env.PAYMENT_HOLD_TIMEOUT_MINUTES, 11);
});

test("validateEnvironment rejects invalid operational policy minutes", () => {
  const { validateEnvironment } = loadEnvModule(validEnv({
    PAYMENT_HOLD_TIMEOUT_MINUTES: "0",
  }));

  assert.throws(
    () => validateEnvironment(),
    /PAYMENT_HOLD_TIMEOUT_MINUTES must be at least 1/
  );
});

test("buildOperationalPolicy exposes minute and millisecond values", () => {
  delete require.cache[operationalPolicyModulePath];
  const {
    buildOperationalPolicy,
  } = require("../shared/config/operationalPolicy");

  const policy = buildOperationalPolicy({
    VOLUNTEER_PICKUP_TIMEOUT_MINUTES: "16",
    VOLUNTEER_DELIVERY_TIMEOUT_MINUTES: "31",
    FOOD_MIN_PICKUP_WINDOW_MINUTES: "32",
    FOOD_MIN_NGO_RESCUE_REMAINING_MINUTES: "33",
    FOOD_EXPIRY_ALERT_LEAD_MINUTES: "34",
    SELF_PICKUP_CANCELLATION_CUTOFF_MINUTES: "21",
    PAYMENT_HOLD_TIMEOUT_MINUTES: "11",
  });

  assert.equal(policy.volunteer.pickupTimeoutMinutes, 16);
  assert.equal(policy.volunteer.pickupTimeoutMs, 16 * 60 * 1000);
  assert.equal(policy.volunteer.deliveryTimeoutMinutes, 31);
  assert.equal(policy.volunteer.deliveryTimeoutMs, 31 * 60 * 1000);
  assert.equal(policy.food.minPickupWindowMinutes, 32);
  assert.equal(policy.food.minPickupWindowMs, 32 * 60 * 1000);
  assert.equal(policy.food.minNgoRescueRemainingMinutes, 33);
  assert.equal(policy.food.minNgoRescueRemainingMs, 33 * 60 * 1000);
  assert.equal(policy.food.expiryAlertLeadMinutes, 34);
  assert.equal(policy.food.expiryAlertLeadMs, 34 * 60 * 1000);
  assert.equal(policy.reservation.selfPickupCancellationCutoffMinutes, 21);
  assert.equal(
    policy.reservation.selfPickupCancellationCutoffMs,
    21 * 60 * 1000
  );
  assert.equal(policy.payment.holdTimeoutMinutes, 11);
  assert.equal(policy.payment.holdTimeoutMs, 11 * 60 * 1000);
});

test("buildOperationalPolicy rejects invalid minute values", () => {
  delete require.cache[operationalPolicyModulePath];
  const {
    buildOperationalPolicy,
  } = require("../shared/config/operationalPolicy");

  assert.throws(
    () => buildOperationalPolicy({ PAYMENT_HOLD_TIMEOUT_MINUTES: "0" }),
    /PAYMENT_HOLD_TIMEOUT_MINUTES must be a positive integer minute value/
  );
});

test("validateEnvironment rejects wildcard or insecure production CORS origins", () => {
  const { validateEnvironment } = loadEnvModule(validEnv({
    APP_ENV: "production",
    NODE_ENV: "production",
    CASHFREE_ENV: "production",
    CASHFREE_APP_ID: "LIVE_APP_ID",
    FRONTEND_URL: "https://app.example.com",
    FRONTEND_ORIGINS: "*,http://app.example.com",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    CASHFREE_WEBHOOK_SECRET: "webhook-secret",
    ENV_RESOURCE_PREFIX: "prod",
    JWT_SECRET: "production-secret-with-at-least-32-chars",
  }));

  assert.throws(
    () => validateEnvironment(),
    /Production CORS origins must be explicit|Production CORS origin must use HTTPS/
  );
});

test("validateEnvironment rejects weak production JWT secrets", () => {
  const { validateEnvironment } = loadEnvModule(validEnv({
    APP_ENV: "production",
    NODE_ENV: "production",
    CASHFREE_ENV: "production",
    CASHFREE_APP_ID: "LIVE_APP_ID",
    FRONTEND_URL: "https://app.example.com",
    FRONTEND_ORIGINS: "https://app.example.com",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    CASHFREE_WEBHOOK_SECRET: "webhook-secret",
    ENV_RESOURCE_PREFIX: "prod",
    JWT_SECRET: "changeme",
  }));

  assert.throws(
    () => validateEnvironment(),
    /JWT_SECRET must be at least 32 characters|development placeholder/
  );
});
