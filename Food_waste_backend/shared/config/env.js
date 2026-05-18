const logger = require("../utils/logger");

const APP_ENVIRONMENTS = new Set([
  "local",
  "development",
  "staging",
  "production",
]);

const BASE_REQUIRED_ENV = [
  "APP_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "FRONTEND_URL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
  "CASHFREE_APP_ID",
  "CASHFREE_SECRET_KEY",
  "CASHFREE_ENV",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const PRODUCTION_REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CASHFREE_WEBHOOK_SECRET",
];

function normalizeNodeEnv() {
  const current = process.env.NODE_ENV;

  if (!current || current === "TEST") {
    process.env.NODE_ENV = "development";
  }
}

function normalizeAppEnv() {
  const configured = (process.env.APP_ENV || process.env.NODE_ENV || "local")
    .toLowerCase()
    .trim();
  const appEnv = configured === "prod" ? "production" : configured;

  if (!APP_ENVIRONMENTS.has(appEnv)) {
    throw new Error(
      `APP_ENV must be one of ${Array.from(APP_ENVIRONMENTS).join(", ")}`
    );
  }

  process.env.APP_ENV = appEnv;
  return appEnv;
}

function isProductionLike(appEnv = process.env.APP_ENV) {
  return appEnv === "production";
}

function isStagingOrProduction(appEnv = process.env.APP_ENV) {
  return appEnv === "staging" || appEnv === "production";
}

function assertRequired(keys) {
  const missing = keys.filter((key) => !String(process.env[key] || "").trim());

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function assertUrl(name, { protocols, httpsOnly = false } = {}) {
  const value = process.env[name];

  try {
    const url = new URL(value);
    if (protocols && !protocols.includes(url.protocol)) {
      throw new Error(`${name} must use one of: ${protocols.join(", ")}`);
    }
    if (httpsOnly && url.protocol !== "https:") {
      throw new Error(`${name} must use HTTPS`);
    }
  } catch (err) {
    if (err.message.startsWith(`${name} must`)) throw err;
    throw new Error(`${name} must be a valid URL`);
  }
}

function assertNumericEnv(name, { min, max, fallback }) {
  const raw = process.env[name] || fallback;
  if (raw === undefined) return;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
}

function assertCashfreeEnvironment(appEnv) {
  const cashfreeEnv = String(process.env.CASHFREE_ENV || "").toLowerCase();
  const appId = String(process.env.CASHFREE_APP_ID || "");
  const allowProductionCredentials =
    process.env.ALLOW_PRODUCTION_CREDENTIALS_IN_NON_PROD === "true";

  if (!["sandbox", "test", "production", "prod"].includes(cashfreeEnv)) {
    throw new Error("CASHFREE_ENV must be sandbox, test, or production");
  }

  const wantsProductionCashfree =
    cashfreeEnv === "production" || cashfreeEnv === "prod" || !appId.startsWith("TEST");

  if (!isProductionLike(appEnv) && wantsProductionCashfree && !allowProductionCredentials) {
    throw new Error(
      "Production Cashfree credentials are blocked outside APP_ENV=production"
    );
  }

  if (isProductionLike(appEnv) && (cashfreeEnv === "sandbox" || cashfreeEnv === "test")) {
    throw new Error("Production deployments must use CASHFREE_ENV=production");
  }
}

function assertSecretStrength(appEnv) {
  const minimumLength = isProductionLike(appEnv) ? 32 : 12;

  if (process.env.JWT_SECRET.length < minimumLength) {
    throw new Error(`JWT_SECRET must be at least ${minimumLength} characters`);
  }

  if (
    isProductionLike(appEnv) &&
    ["secret", "supersecret", "supersecretkey", "changeme"].includes(
      process.env.JWT_SECRET.toLowerCase()
    )
  ) {
    throw new Error("JWT_SECRET must not use a development placeholder");
  }
}

function assertEnvironmentIsolation(appEnv) {
  if (isProductionLike(appEnv) && process.env.NODE_ENV !== "production") {
    throw new Error("APP_ENV=production requires NODE_ENV=production");
  }

  if (!isProductionLike(appEnv) && process.env.NODE_ENV === "production") {
    throw new Error("NODE_ENV=production requires APP_ENV=production");
  }

  if (isStagingOrProduction(appEnv) && !process.env.ENV_RESOURCE_PREFIX) {
    throw new Error(
      "ENV_RESOURCE_PREFIX is required for staging/production to isolate Redis, queues, storage, and webhooks"
    );
  }
}

function validateEnvironment() {
  normalizeNodeEnv();
  const appEnv = normalizeAppEnv();
  const required = [...BASE_REQUIRED_ENV];

  if (isProductionLike(appEnv)) {
    required.push(...PRODUCTION_REQUIRED_ENV);
  }

  assertRequired(required);
  assertEnvironmentIsolation(appEnv);
  assertUrl("DATABASE_URL", { protocols: ["postgres:", "postgresql:"] });
  assertUrl("REDIS_URL", { protocols: ["redis:", "rediss:"] });
  assertUrl("FRONTEND_URL", { protocols: ["http:", "https:"], httpsOnly: isProductionLike(appEnv) });

  if (process.env.SUPABASE_URL) {
    assertUrl("SUPABASE_URL", { protocols: ["https:"], httpsOnly: true });
  }

  if (!process.env.TWILIO_ACCOUNT_SID.startsWith("AC")) {
    throw new Error("TWILIO_ACCOUNT_SID must be a valid Twilio Account SID");
  }

  if (!process.env.TWILIO_VERIFY_SERVICE_SID.startsWith("VA")) {
    throw new Error(
      "TWILIO_VERIFY_SERVICE_SID must be a valid Twilio Verify Service SID"
    );
  }

  assertSecretStrength(appEnv);
  assertCashfreeEnvironment(appEnv);
  assertNumericEnv("SOCKET_PING_INTERVAL_MS", { min: 5000, max: 60000, fallback: "25000" });
  assertNumericEnv("SOCKET_PING_TIMEOUT_MS", { min: 5000, max: 60000, fallback: "20000" });
  assertNumericEnv("QUEUE_WORKER_CONCURRENCY", { min: 1, max: 50, fallback: "5" });
  assertNumericEnv("MAX_UPLOAD_BYTES", { min: 1024, max: 10 * 1024 * 1024, fallback: String(5 * 1024 * 1024) });

  logger.info("Environment validated", {
    appEnv,
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT || 5000,
  });
}

module.exports = {
  APP_ENVIRONMENTS,
  isProductionLike,
  isStagingOrProduction,
  validateEnvironment,
};
