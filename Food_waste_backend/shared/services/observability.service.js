const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");
const logger = require("../utils/logger");
const { getContext } = require("../utils/requestContext");
const {
  incrementCounter,
  recordPaymentEvent,
} = require("./metrics.service");

let schemaReady;

async function ensureObservabilitySchema(client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) {
    schemaReady = schemaReady || Promise.resolve();
    return schemaReady;
  }

  if (!schemaReady || client !== pool) {
    const run = async () => {
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS operational_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          category TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          event_name TEXT NOT NULL,
          request_id TEXT NULL,
          correlation_id TEXT NULL,
          user_id UUID NULL,
          role TEXT NULL,
          reservation_id UUID NULL,
          payment_session_id TEXT NULL,
          queue_job_id TEXT NULL,
          worker_name TEXT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS operational_alerts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          alert_key TEXT NOT NULL,
          category TEXT NOT NULL,
          severity TEXT NOT NULL,
          message TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'open',
          first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
          occurrences INTEGER NOT NULL DEFAULT 1
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS worker_heartbeats (
          worker_name TEXT PRIMARY KEY,
          queue_name TEXT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          last_job_id TEXT NULL,
          last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);
      await client.query(`
        DO $$
        DECLARE
          target record;
        BEGIN
          FOR target IN
            SELECT *
            FROM (VALUES
              ('operational_events', 'request_id'),
              ('operational_events', 'correlation_id'),
              ('operational_events', 'payment_session_id'),
              ('operational_events', 'queue_job_id'),
              ('operational_events', 'worker_name'),
              ('operational_events', 'category'),
              ('operational_events', 'severity'),
              ('operational_events', 'event_name'),
              ('operational_events', 'role'),
              ('operational_alerts', 'alert_key'),
              ('operational_alerts', 'category'),
              ('operational_alerts', 'severity'),
              ('operational_alerts', 'message'),
              ('operational_alerts', 'status'),
              ('worker_heartbeats', 'worker_name'),
              ('worker_heartbeats', 'queue_name'),
              ('worker_heartbeats', 'status'),
              ('worker_heartbeats', 'last_job_id')
            ) AS columns_to_widen(table_name, column_name)
          LOOP
            IF EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = current_schema()
              AND table_name = target.table_name
              AND column_name = target.column_name
              AND data_type = 'character varying'
              AND (character_maximum_length IS NULL OR character_maximum_length < 128)
            ) THEN
              EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I TYPE TEXT',
                target.table_name,
                target.column_name
              );
            END IF;
          END LOOP;
        END $$;
      `);
      await client.query(`
        ALTER TABLE operational_events
        ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_operational_events_created
        ON operational_events (created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_operational_events_category
        ON operational_events (category, severity, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_operational_events_correlation
        ON operational_events (correlation_id, created_at DESC)
        WHERE correlation_id IS NOT NULL
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_alerts_open_key
        ON operational_alerts (alert_key)
        WHERE status='open'
      `);
    };

    if (client === pool) {
      schemaReady = run();
      return schemaReady;
    }

    return run();
  }

  return schemaReady;
}

function toUuidOrNull(value) {
  if (!value) return null;
  const stringValue = String(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stringValue)
    ? stringValue
    : null;
}

async function recordOperationalEvent({
  category,
  severity = "info",
  eventName,
  metadata = {},
}) {
  const context = getContext();
  incrementCounter("food_rescue_operational_events_total", {
    category,
    severity,
    event: eventName,
  });
  if (category === "payment") {
    recordPaymentEvent({ eventName, severity, status: metadata.status });
  }
  const redactedMetadata = logger.redact(metadata || {});

  try {
    await ensureObservabilitySchema();
    await pool.query(
      `
      INSERT INTO operational_events (
        category, severity, event_name, request_id, correlation_id, user_id, role,
        reservation_id, payment_session_id, queue_job_id, worker_name, metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      `,
      [
        category,
        severity,
        eventName,
        context.requestId,
        context.correlationId,
        toUuidOrNull(context.userId),
        context.role,
        toUuidOrNull(context.reservationId),
        context.paymentSessionId,
        context.queueJobId ? String(context.queueJobId) : null,
        context.workerName,
        JSON.stringify(redactedMetadata),
      ]
    );
  } catch (err) {
    logger.warn("Operational event capture failed", { err, category, eventName });
  }
}

async function recordAlert({
  alertKey,
  category,
  severity = "warning",
  message,
  metadata = {},
}) {
  incrementCounter("food_rescue_operational_alerts_total", {
    category,
    severity,
  });
  const redactedMetadata = logger.redact(metadata || {});

  try {
    await ensureObservabilitySchema();
    await pool.query(
      `
      INSERT INTO operational_alerts (alert_key, category, severity, message, metadata)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (alert_key)
      WHERE status='open'
      DO UPDATE SET
        last_seen_at=NOW(),
        occurrences=operational_alerts.occurrences + 1,
        severity=EXCLUDED.severity,
        message=EXCLUDED.message,
        metadata=EXCLUDED.metadata
      `,
      [alertKey, category, severity, message, JSON.stringify(redactedMetadata)]
    );
  } catch (err) {
    logger.warn("Operational alert capture failed", { err, alertKey });
  }
}

async function heartbeatWorker(workerName, queueName, status = "running", metadata = {}) {
  try {
    await ensureObservabilitySchema();
    await pool.query(
      `
      INSERT INTO worker_heartbeats (worker_name, queue_name, status, last_job_id, metadata)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (worker_name)
      DO UPDATE SET queue_name=$2, status=$3, last_job_id=$4,
                    last_seen_at=NOW(), metadata=$5::jsonb
      `,
      [
        workerName,
        queueName,
        status,
        metadata.lastJobId ? String(metadata.lastJobId) : null,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (err) {
    logger.warn("Worker heartbeat failed", { err, workerName, queueName });
  }
}

module.exports = {
  ensureObservabilitySchema,
  heartbeatWorker,
  recordAlert,
  recordOperationalEvent,
};
