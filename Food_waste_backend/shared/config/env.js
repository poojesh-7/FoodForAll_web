const logger = require("../utils/logger");

const REQUIRED_ENV = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"];
const PRODUCTION_REQUIRED_ENV = [
  "FRONTEND_URL",
  "CASHFREE_APP_ID",
  "CASHFREE_SECRET_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

function normalizeNodeEnv() {
  const current = process.env.NODE_ENV;

  if (!current || current === "TEST") {
    process.env.NODE_ENV = "development";
  }
}

function validateEnvironment() {
  normalizeNodeEnv();

  const required = [...REQUIRED_ENV];

  if (process.env.NODE_ENV === "production") {
    required.push(...PRODUCTION_REQUIRED_ENV);
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (process.env.NODE_ENV === "production") {
    if (process.env.JWT_SECRET.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters in production");
    }

    if (!process.env.FRONTEND_URL?.startsWith("https://")) {
      throw new Error("FRONTEND_URL must use HTTPS in production");
    }
  }

  logger.info("Environment validated", {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT || 5000,
  });
}

module.exports = {
  validateEnvironment,
};
