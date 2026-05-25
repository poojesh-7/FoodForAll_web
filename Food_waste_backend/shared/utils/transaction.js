const logger = require("./logger");

const RETRYABLE_TRANSACTION_CODES = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
  "55P03", // lock_not_available
]);

const VALID_ISOLATION_LEVELS = new Set([
  "READ COMMITTED",
  "REPEATABLE READ",
  "SERIALIZABLE",
]);

function isRetryableTransactionError(err) {
  return RETRYABLE_TRANSACTION_CODES.has(String(err?.code || ""));
}

function normalizeIsolationLevel(isolationLevel) {
  if (!isolationLevel) return null;

  const normalized = String(isolationLevel).trim().toUpperCase();
  return VALID_ISOLATION_LEVELS.has(normalized) ? normalized : null;
}

async function applyTransactionTimeouts(client, options = {}) {
  const lockTimeoutMs = Number(options.lockTimeoutMs || process.env.DB_LOCK_TIMEOUT_MS || 4000);
  const statementTimeoutMs = Number(
    options.statementTimeoutMs || process.env.DB_STATEMENT_TIMEOUT_MS || 30000
  );
  const idleTimeoutMs = Number(
    options.idleInTransactionTimeoutMs ||
      process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS ||
      30000
  );

  await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMs}ms`]);
  await client.query("SELECT set_config('statement_timeout', $1, true)", [
    `${statementTimeoutMs}ms`,
  ]);
  await client.query("SELECT set_config('idle_in_transaction_session_timeout', $1, true)", [
    `${idleTimeoutMs}ms`,
  ]);
}

async function beginTransaction(client, options = {}) {
  const isolationLevel = normalizeIsolationLevel(options.isolationLevel);
  await client.query(isolationLevel ? `BEGIN ISOLATION LEVEL ${isolationLevel}` : "BEGIN");
  await applyTransactionTimeouts(client, options);
}

async function rollbackQuietly(client) {
  try {
    await client.query("ROLLBACK");
  } catch (err) {
    logger.warn("Transaction rollback failed", { err });
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTransaction(pool, callback, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const name = options.name || "transaction";
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await pool.connect();

    try {
      await beginTransaction(client, options);
      const result = await callback(client, { attempt });
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await rollbackQuietly(client);
      lastError = err;

      if (!isRetryableTransactionError(err) || attempt >= maxAttempts) {
        throw err;
      }

      const retryDelayMs =
        Number(options.retryDelayMs || 75) * attempt + Math.floor(Math.random() * 50);
      logger.warn("Retrying transaction after retryable database error", {
        name,
        attempt,
        maxAttempts,
        retryDelayMs,
        code: err.code,
      });
      await delay(retryDelayMs);
    } finally {
      client.release();
    }
  }

  throw lastError;
}

module.exports = {
  beginTransaction,
  isRetryableTransactionError,
  rollbackQuietly,
  withTransaction,
};
