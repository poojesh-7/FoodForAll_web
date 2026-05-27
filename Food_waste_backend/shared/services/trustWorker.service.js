const pool = require("../config/db");
const logger = require("../utils/logger");
const {
  beginTransaction,
  isRetryableTransactionError,
  rollbackQuietly,
} = require("../utils/transaction");
const {
  claimTrustEvents,
  getTrustProcessingStats,
  markTrustEventProcessed,
  markTrustEventRetry,
} = require("./trustEvent.service");
const { applyTrustEventProjection } = require("./trustProjection.service");
const {
  incrementCounter,
  observeHistogram,
} = require("./metrics.service");
const {
  recordOperationalEvent,
} = require("./observability.service");

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runTrustEventTransaction(db, callback, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const name = options.name || "trust_event";
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await db.connect();

    try {
      await beginTransaction(client, options);
      const result = await callback(client, { attempt });
      await client.query("COMMIT");
      return result;
    } catch (err) {
      lastError = err;
      await rollbackQuietly(client);

      incrementCounter("food_rescue_trust_worker_rollbacks_total", {
        scope: "transaction",
        reason: err.code || "unknown",
      });
      incrementCounter("food_rescue_trust_worker_transaction_failures_total", {
        name,
        code: err.code || "unknown",
      });
      logger.warn("Trust worker transaction rolled back", {
        err,
        name,
        attempt,
        maxAttempts,
        code: err.code,
      });

      if (!isRetryableTransactionError(err) || attempt >= maxAttempts) {
        throw err;
      }

      const retryDelayMs =
        Number(options.retryDelayMs || 75) * attempt + Math.floor(Math.random() * 50);
      incrementCounter("food_rescue_trust_worker_transaction_retries_total", {
        name,
        code: err.code || "unknown",
      });
      logger.warn("Retrying trust worker transaction after retryable database error", {
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

async function rollbackProjectionSavepoint(client, event, err) {
  await client.query("ROLLBACK TO SAVEPOINT trust_event_projection");
  incrementCounter("food_rescue_trust_worker_rollbacks_total", {
    scope: "projection_savepoint",
    reason: err.code || "unknown",
  });
  logger.warn("Trust event projection savepoint rolled back", {
    err,
    eventId: event.id,
    eventKey: event.event_key,
    eventType: event.event_type,
    code: err.code,
  });
}

async function processClaimedEvent(client, event, options = {}) {
  const startedAt = Date.now();
  let savepointActive = false;

  try {
    await client.query("SAVEPOINT trust_event_projection");
    savepointActive = true;
    const result = await applyTrustEventProjection(client, event);
    await client.query("RELEASE SAVEPOINT trust_event_projection");
    savepointActive = false;
    await markTrustEventProcessed(client, event.id);
    observeHistogram("food_rescue_trust_event_processing_duration_ms", {}, Date.now() - startedAt);
    incrementCounter("food_rescue_trust_projection_effects_total", {
      applied: result.applied ? "true" : "false",
      event_type: event.event_type || "unknown",
    });
    if (!result.applied) {
      incrementCounter("food_rescue_trust_retry_safe_completions_total", {
        reason: "duplicate_effect",
        event_type: event.event_type || "unknown",
      });
      logger.info("Trust event completed without duplicate projection", {
        eventId: event.id,
        eventKey: event.event_key,
        eventType: event.event_type,
        effectHash: result.effectHash,
      });
    }
    return {
      eventId: event.id,
      eventKey: event.event_key,
      processed: true,
      applied: result.applied,
    };
  } catch (err) {
    if (savepointActive) {
      await rollbackProjectionSavepoint(client, event, err);
      savepointActive = false;
    }

    const status = await markTrustEventRetry(client, event, err, options);
    logger.warn("Trust event processing failed", {
      err,
      eventId: event.id,
      eventKey: event.event_key,
      status,
    });
    return {
      eventId: event.id,
      eventKey: event.event_key,
      processed: false,
      status,
      error: err.message,
    };
  }
}

async function processNextTrustEvent(options = {}) {
  const db = options.pool || pool;
  const limit = Math.max(1, Math.min(Number(options.claimLimit || 1), 1));

  return runTrustEventTransaction(
    db,
    async (client) => {
      const events = await claimTrustEvents(client, {
        limit,
        eventKey: options.eventKey,
        excludeEventIds: options.excludeEventIds,
      });

      if (!events.length) return null;

      return processClaimedEvent(client, events[0], options);
    },
    {
      name: "trust_event",
      maxAttempts: Number(options.transactionMaxAttempts || 3),
      lockTimeoutMs: Number(process.env.TRUST_DB_LOCK_TIMEOUT_MS || 1500),
      statementTimeoutMs: Number(process.env.TRUST_DB_STATEMENT_TIMEOUT_MS || 15000),
    }
  );
}

async function processTrustEventBatch(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || process.env.TRUST_WORKER_BATCH_SIZE || 25), 100));
  const eventKey = options.eventKey || null;
  const results = [];
  const excludeEventIds = [];

  for (let index = 0; index < limit; index += 1) {
    const result = await processNextTrustEvent({
      ...options,
      eventKey,
      excludeEventIds,
    });

    if (!result) break;

    results.push(result);
    excludeEventIds.push(result.eventId);
  }

  if (results.length && options.recordOperationalEvent !== false) {
    void recordOperationalEvent({
      category: "trust",
      severity: "info",
      eventName: "trust_event_batch_processed",
      metadata: {
        processed: results.filter((result) => result.processed).length,
        failed: results.filter((result) => !result.processed).length,
      },
    });
  }

  await getTrustProcessingStats(options.pool || pool).catch((err) => {
    logger.warn("Trust processing stats refresh failed", { err });
  });

  return results;
}

module.exports = {
  processClaimedEvent,
  processNextTrustEvent,
  processTrustEventBatch,
  runTrustEventTransaction,
};
