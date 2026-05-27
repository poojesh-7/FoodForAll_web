const pool = require("../config/db");
const logger = require("../utils/logger");
const { withTransaction } = require("../utils/transaction");
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

async function processClaimedEvent(client, event, options = {}) {
  const startedAt = Date.now();

  try {
    const result = await applyTrustEventProjection(client, event);
    await markTrustEventProcessed(client, event.id);
    observeHistogram("food_rescue_trust_event_processing_duration_ms", {}, Date.now() - startedAt);
    incrementCounter("food_rescue_trust_projection_effects_total", {
      applied: result.applied ? "true" : "false",
      event_type: event.event_type || "unknown",
    });
    return {
      eventId: event.id,
      eventKey: event.event_key,
      processed: true,
      applied: result.applied,
    };
  } catch (err) {
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

async function processTrustEventBatch(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || process.env.TRUST_WORKER_BATCH_SIZE || 25), 100));
  const eventKey = options.eventKey || null;

  const results = await withTransaction(
    options.pool || pool,
    async (client) => {
      const events = await claimTrustEvents(client, { limit, eventKey });
      const processed = [];

      for (const event of events) {
        processed.push(await processClaimedEvent(client, event, options));
      }

      return processed;
    },
    {
      name: "trust_event_batch",
      maxAttempts: 3,
      lockTimeoutMs: Number(process.env.TRUST_DB_LOCK_TIMEOUT_MS || 1500),
      statementTimeoutMs: Number(process.env.TRUST_DB_STATEMENT_TIMEOUT_MS || 15000),
    }
  );

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
  processTrustEventBatch,
};
