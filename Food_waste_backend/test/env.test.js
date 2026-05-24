const assert = require("node:assert/strict");
const test = require("node:test");

const originalEnv = { ...process.env };
const envModulePath = require.resolve("../shared/config/env");

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
});

test("validateEnvironment accepts explicit development configuration", () => {
  const { validateEnvironment } = loadEnvModule(validEnv({
    FRONTEND_ORIGINS: "http://localhost:3001, http://127.0.0.1:3000/",
  }));

  const env = validateEnvironment();

  assert.equal(env.APP_ENV, "development");
  assert.equal(process.env.FRONTEND_ORIGINS, "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000");
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
