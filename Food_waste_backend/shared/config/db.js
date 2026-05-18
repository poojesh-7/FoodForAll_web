const { Pool } = require("pg");
const logger = require("../utils/logger");

const sslMode = String(process.env.PGSSL || process.env.DATABASE_SSL || "").toLowerCase();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    sslMode === "require" || sslMode === "true"
      ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" }
      : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000),
});

pool.on("connect", () => {
  logger.info("PostgreSQL connected");
});

pool.on("error", (err) => {
  logger.error("PostgreSQL error", { err });
});

module.exports = pool;
