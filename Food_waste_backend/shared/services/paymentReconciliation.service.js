const crypto = require("crypto");
const pool = require("../config/db");
const redis = require("../config/redis");
const cashfree = require("../config/cashfree");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");
const notificationQueue = require("../../queues/notification.queue");
const refundQueue = require("../../queues/refund.queue");
const logger = require("../utils/logger");
const {
  PaymentError,
  WebhookVerificationError,
} = require("../utils/errors");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");
const { recordPaymentEvent } = require("./metrics.service");
const generatePickupCode = require("../../utils/codeGenerator");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");
const {
  ensureReservationPaymentContextSchema,
  hasReservedStock,
  parsePaymentContext,
} = require("./reservationPaymentContext.service");
const {
  reserveListingStock,
} = require("./inventory.service");
const {
  lockPaymentGraphByOrderId,
  lockPaymentById,
  lockReservationGraph,
  restoreReservationStockIfHeld,
} = require("./reservationConsistency.service");
const {
  createFinancialOwnershipSnapshot,
  roundMoney,
} = require("./financialOwnership.service");
const {
  normalizeRefundStatusFromGateway,
  shouldApplyRefundWebhook,
} = require("./financialStateMachine.service");
const {
  markFinancialOperationStatusByRefundId,
  operationStatusFromRefundStatus,
} = require("./refundExecution.service");
const {
  prepareLifecycleAccounting,
} = require("./lifecycleAccounting.service");
const {
  ensureSettlementAccountingSchema,
  recordSettlementAllocation,
} = require("./financialLedger.service");
const {
  getReservationSnapshot,
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
} = require("./realtime.service");
const { jobOptions } = require("../utils/queueOptions");
const { withTransaction } = require("../utils/transaction");

const paidStatuses = new Set(["PAID", "SUCCESS"]);
const failedStatuses = new Set(["FAILED", "EXPIRED", "CANCELLED", "USER_DROPPED"]);
const refundedPaymentStates = new Set(["refund_pending", "refunded"]);
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
const WEBHOOK_PROCESSING_LOCK_TTL_SECONDS = 5 * 60;
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const PAYMENT_RECONCILIATION_LIMIT = 100;
const PAYMENT_ORDER_ATTEMPT_RECOVERY_LIMIT = 50;
const REFUND_RECONCILIATION_LIMIT = 50;
const REFUND_RECONCILIATION_STALE_MINUTES = 10;

let schemaReady;

function toRawBody(body) {
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(JSON.stringify(body || {}), "utf8");
}

function rawBodyToString(rawBody) {
  return Buffer.isBuffer(rawBody)
    ? rawBody.toString("utf8")
    : String(rawBody || "");
}

function getHeaderValue(headers, headerName) {
  const value = headers?.[headerName] || headers?.[headerName.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isFreshWebhookTimestamp(timestamp) {
  if (!timestamp) return false;

  const rawTimestamp = String(timestamp).trim();
  const numericTimestamp = Number(rawTimestamp);
  const timestampMs = Number.isFinite(numericTimestamp)
    ? numericTimestamp > 9999999999
      ? numericTimestamp
      : numericTimestamp * 1000
    : Date.parse(rawTimestamp);

  if (!Number.isFinite(timestampMs)) return false;

  const ageSeconds = Math.abs(Date.now() - timestampMs) / 1000;
  return ageSeconds <= WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyCashfreeWebhookSignature({ rawBody, signature, timestamp }) {
  if (!signature || !timestamp) {
    throw new WebhookVerificationError("Missing Cashfree webhook signature headers");
  }

  if (!process.env.CASHFREE_SECRET_KEY) {
    throw new PaymentError("Cashfree webhook secret is not configured", {
      statusCode: 500,
    });
  }

  if (!isFreshWebhookTimestamp(timestamp)) {
    throw new WebhookVerificationError("Stale Cashfree webhook timestamp");
  }

  const rawBuffer = toRawBody(rawBody);
  const signedPayload = Buffer.concat([
    Buffer.from(String(timestamp), "utf8"),
    rawBuffer,
  ]);
  const expectedSignature = crypto
    .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
    .update(signedPayload)
    .digest("base64");

  if (!timingSafeEqualString(expectedSignature, signature)) {
    throw new WebhookVerificationError("Invalid Cashfree webhook signature");
  }
}

async function ensurePaymentHardeningSchema(_client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) {
    schemaReady = schemaReady || Promise.resolve();
    return schemaReady;
  }

  const client = pool;

  if (!schemaReady || client !== pool) {
    const run = async () => {
      await ensureRestrictionSchema(client);
      await ensureReservationPaymentContextSchema(client);
      await ensureSettlementAccountingSchema(client);

      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      await client.query(`
        ALTER TABLE reservations
        ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMP NULL
      `);

      await client.query(`
        ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS transaction_id TEXT NULL,
        ADD COLUMN IF NOT EXISTS payment_method TEXT NULL,
        ADD COLUMN IF NOT EXISTS refund_id TEXT NULL,
        ADD COLUMN IF NOT EXISTS refund_status TEXT NULL,
        ADD COLUMN IF NOT EXISTS gateway_status TEXT NULL,
        ADD COLUMN IF NOT EXISTS last_webhook_event_key TEXT NULL,
        ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NULL,
        ADD COLUMN IF NOT EXISTS reconciliation_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS refund_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reliability_deposit_refund_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS payment_terminal_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS refund_terminal_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS financial_state_version INTEGER NOT NULL DEFAULT 0
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS cashfree_webhook_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          idempotency_key TEXT NOT NULL UNIQUE,
          event_type TEXT NULL,
          order_id TEXT NULL,
          cf_payment_id TEXT NULL,
          refund_id TEXT NULL,
          status TEXT NOT NULL DEFAULT 'processing',
          attempts INTEGER NOT NULL DEFAULT 1,
          payload JSONB NOT NULL,
          payload_hash TEXT NOT NULL,
          signature TEXT NULL,
          webhook_timestamp TEXT NULL,
          received_at TIMESTAMP NOT NULL DEFAULT NOW(),
          processed_at TIMESTAMP NULL,
          failure_reason TEXT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS payment_order_attempts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id TEXT NOT NULL UNIQUE,
          payer_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
          reservation_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
          amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'INR',
          status TEXT NOT NULL DEFAULT 'creating',
          payment_session_id TEXT NULL,
          reservation_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
          gateway_response JSONB NOT NULL DEFAULT '{}'::jsonb,
          failure_reason TEXT NULL,
          recovery_attempts INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          recovered_at TIMESTAMP NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS cashfree_webhook_audit_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          idempotency_key TEXT NULL,
          event_type TEXT NULL,
          order_id TEXT NULL,
          cf_payment_id TEXT NULL,
          refund_id TEXT NULL,
          processing_status TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          signature_present BOOLEAN NOT NULL DEFAULT false,
          webhook_timestamp TEXT NULL,
          rejection_reason TEXT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          received_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS financial_state_transitions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
          reservation_id UUID NULL REFERENCES reservations(id) ON DELETE RESTRICT,
          order_id TEXT NULL,
          old_payment_status TEXT NULL,
          new_payment_status TEXT NULL,
          old_refund_status TEXT NULL,
          new_refund_status TEXT NULL,
          old_deposit_status TEXT NULL,
          new_deposit_status TEXT NULL,
          transition_source TEXT NOT NULL DEFAULT 'database_trigger',
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
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
              ('cashfree_webhook_events', 'idempotency_key'),
              ('cashfree_webhook_events', 'event_type'),
              ('cashfree_webhook_events', 'order_id'),
              ('cashfree_webhook_events', 'cf_payment_id'),
              ('cashfree_webhook_events', 'refund_id'),
              ('cashfree_webhook_events', 'status'),
              ('cashfree_webhook_events', 'payload_hash'),
              ('cashfree_webhook_events', 'signature'),
              ('cashfree_webhook_events', 'webhook_timestamp'),
              ('cashfree_webhook_audit_log', 'idempotency_key'),
              ('cashfree_webhook_audit_log', 'event_type'),
              ('cashfree_webhook_audit_log', 'order_id'),
              ('cashfree_webhook_audit_log', 'cf_payment_id'),
              ('cashfree_webhook_audit_log', 'refund_id'),
              ('cashfree_webhook_audit_log', 'processing_status'),
              ('cashfree_webhook_audit_log', 'payload_hash'),
              ('cashfree_webhook_audit_log', 'webhook_timestamp'),
              ('payment_order_attempts', 'order_id'),
              ('payment_order_attempts', 'payment_session_id'),
              ('payment_order_attempts', 'status'),
              ('payment_order_attempts', 'currency'),
              ('financial_state_transitions', 'order_id'),
              ('financial_state_transitions', 'old_payment_status'),
              ('financial_state_transitions', 'new_payment_status'),
              ('financial_state_transitions', 'old_refund_status'),
              ('financial_state_transitions', 'new_refund_status'),
              ('financial_state_transitions', 'old_deposit_status'),
              ('financial_state_transitions', 'new_deposit_status'),
              ('financial_state_transitions', 'transition_source'),
              ('payments', 'order_id'),
              ('payments', 'payment_session_id'),
              ('payments', 'transaction_id'),
              ('payments', 'payment_method'),
              ('payments', 'refund_id'),
              ('payments', 'refund_status'),
              ('payments', 'gateway_status'),
              ('payments', 'last_webhook_event_key'),
              ('payments', 'reconciliation_status'),
              ('payments', 'reliability_deposit_status'),
              ('payments', 'reliability_deposit_refund_id'),
              ('reservations', 'payment_status'),
              ('reservations', 'status'),
              ('reservations', 'task_status'),
              ('reservations', 'pickup_type')
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
        CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_events_order
        ON cashfree_webhook_events (order_id, received_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_events_status
        ON cashfree_webhook_events (status, received_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_audit_order
        ON cashfree_webhook_audit_log (order_id, received_at DESC)
        WHERE order_id IS NOT NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_audit_refund
        ON cashfree_webhook_audit_log (refund_id, received_at DESC)
        WHERE refund_id IS NOT NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_audit_status
        ON cashfree_webhook_audit_log (processing_status, received_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payment_order_attempts_status_updated
        ON payment_order_attempts (status, updated_at)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payment_order_attempts_payer
        ON payment_order_attempts (payer_user_id, created_at DESC)
        WHERE payer_user_id IS NOT NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_financial_state_transitions_payment
        ON financial_state_transitions (payment_id, created_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_financial_state_transitions_reservation
        ON financial_state_transitions (reservation_id, created_at DESC)
        WHERE reservation_id IS NOT NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payments_order_status
        ON payments (order_id, status)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payments_order_reservation_lock
        ON payments (order_id, reservation_id, id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payments_reservation
        ON payments (reservation_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payments_reservation_status_updated
        ON payments (reservation_id, status, updated_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reservations_pending_payment
        ON reservations (payment_status, status, payment_expires_at)
        WHERE status='payment_pending' AND payment_status='pending'
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reservations_listing_payment_state
        ON reservations (listing_id, status, payment_status, id)
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_payment_reservation
        ON reservations (user_id, listing_id)
        WHERE status='payment_pending' AND payment_status='pending'
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_id_unique
        ON payments (transaction_id)
        WHERE transaction_id IS NOT NULL
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_refund_id_unique
        ON payments (refund_id)
        WHERE refund_id IS NOT NULL
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_deposit_refund_id_unique
        ON payments (reliability_deposit_refund_id)
        WHERE reliability_deposit_refund_id IS NOT NULL
      `);

      await client.query(`
        CREATE OR REPLACE FUNCTION prevent_cashfree_webhook_audit_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'cashfree_webhook_audit_log rows are immutable';
        END;
        $$;
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS trg_cashfree_webhook_audit_immutable ON cashfree_webhook_audit_log;
        CREATE TRIGGER trg_cashfree_webhook_audit_immutable
          BEFORE UPDATE OR DELETE ON cashfree_webhook_audit_log
          FOR EACH ROW
          EXECUTE FUNCTION prevent_cashfree_webhook_audit_mutation();
      `);

      await client.query(`
        CREATE OR REPLACE FUNCTION prevent_financial_state_transition_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'financial_state_transitions rows are immutable';
        END;
        $$;
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS trg_financial_state_transitions_immutable ON financial_state_transitions;
        CREATE TRIGGER trg_financial_state_transitions_immutable
          BEFORE UPDATE OR DELETE ON financial_state_transitions
          FOR EACH ROW
          EXECUTE FUNCTION prevent_financial_state_transition_mutation();
      `);

      await client.query(`
        CREATE OR REPLACE FUNCTION guard_payment_financial_state_transition()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          old_status TEXT := COALESCE(OLD.status, 'created');
          new_status TEXT := COALESCE(NEW.status, old_status);
          old_refund_status TEXT := COALESCE(OLD.refund_status, 'not_requested');
          new_refund_status TEXT := COALESCE(NEW.refund_status, old_refund_status);
          old_deposit_status TEXT := COALESCE(OLD.reliability_deposit_status, 'not_required');
          new_deposit_status TEXT := COALESCE(NEW.reliability_deposit_status, old_deposit_status);
        BEGIN
          IF old_status = 'refunded' AND new_status <> 'refunded' THEN
            RAISE EXCEPTION 'Illegal payment state transition from refunded to %', new_status;
          END IF;

          IF old_status = 'paid' AND new_status IN ('created','pending','failed','expired') THEN
            RAISE EXCEPTION 'Illegal payment state transition from paid to %', new_status;
          END IF;

          IF old_status = 'refund_pending' AND new_status IN ('created','pending','paid','failed','expired') THEN
            RAISE EXCEPTION 'Illegal payment state transition from refund_pending to %', new_status;
          END IF;

          IF old_status = 'refund_failed' AND new_status IN ('created','pending','paid','failed','expired') THEN
            RAISE EXCEPTION 'Illegal payment state transition from refund_failed to %', new_status;
          END IF;

          IF old_status IN ('failed','expired') AND new_status IN ('created','pending','paid') THEN
            RAISE EXCEPTION 'Illegal payment state transition from % to %', old_status, new_status;
          END IF;

          IF old_refund_status = 'refunded' AND new_refund_status <> 'refunded' THEN
            RAISE EXCEPTION 'Illegal refund status transition from refunded to %', new_refund_status;
          END IF;

          IF old_refund_status = 'refund_failed' AND new_refund_status = 'refund_pending'
             AND new_status <> 'refund_pending' THEN
            RAISE EXCEPTION 'Illegal stale refund status transition from refund_failed to refund_pending';
          END IF;

          IF old_deposit_status IN ('refunded','retained')
             AND new_deposit_status <> old_deposit_status THEN
            RAISE EXCEPTION 'Illegal reliability deposit transition from % to %',
              old_deposit_status,
              new_deposit_status;
          END IF;

          IF new_status IN ('paid','failed','expired','refunded','refund_failed')
             AND OLD.payment_terminal_at IS NULL THEN
            NEW.payment_terminal_at = NOW();
          END IF;

          IF new_status IN ('refunded','refund_failed')
             AND OLD.refund_terminal_at IS NULL THEN
            NEW.refund_terminal_at = NOW();
          END IF;

          IF old_status IS DISTINCT FROM new_status
             OR old_refund_status IS DISTINCT FROM new_refund_status
             OR old_deposit_status IS DISTINCT FROM new_deposit_status THEN
            NEW.financial_state_version = COALESCE(OLD.financial_state_version, 0) + 1;
          END IF;

          RETURN NEW;
        END;
        $$;
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS trg_payments_financial_state_guard ON payments;
        CREATE TRIGGER trg_payments_financial_state_guard
          BEFORE UPDATE ON payments
          FOR EACH ROW
          EXECUTE FUNCTION guard_payment_financial_state_transition();
      `);

      await client.query(`
        CREATE OR REPLACE FUNCTION log_payment_financial_state_transition()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF OLD.status IS DISTINCT FROM NEW.status
             OR OLD.refund_status IS DISTINCT FROM NEW.refund_status
             OR OLD.reliability_deposit_status IS DISTINCT FROM NEW.reliability_deposit_status THEN
            INSERT INTO financial_state_transitions (
              payment_id,
              reservation_id,
              order_id,
              old_payment_status,
              new_payment_status,
              old_refund_status,
              new_refund_status,
              old_deposit_status,
              new_deposit_status,
              metadata
            )
            VALUES (
              NEW.id,
              NEW.reservation_id,
              NEW.order_id,
              OLD.status,
              NEW.status,
              OLD.refund_status,
              NEW.refund_status,
              OLD.reliability_deposit_status,
              NEW.reliability_deposit_status,
              jsonb_build_object(
                'gateway_status', NEW.gateway_status,
                'reconciliation_status', NEW.reconciliation_status,
                'financial_state_version', NEW.financial_state_version
              )
            );
          END IF;

          RETURN NEW;
        END;
        $$;
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS trg_payments_financial_state_transition_log ON payments;
        CREATE TRIGGER trg_payments_financial_state_transition_log
          AFTER UPDATE ON payments
          FOR EACH ROW
          EXECUTE FUNCTION log_payment_financial_state_transition();
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

function normalizeFailedStatus(orderStatus) {
  return orderStatus === "EXPIRED" ? "expired" : "failed";
}

function serializePaymentMethod(paymentMethod) {
  if (!paymentMethod) return null;
  return typeof paymentMethod === "string"
    ? paymentMethod
    : JSON.stringify(paymentMethod);
}

function getWebhookIdempotencyHeader(headers) {
  const key =
    headers?.["x-idempotency-key"] ||
    headers?.["x-idempotency-header"] ||
    headers?.["cf-event-id"] ||
    headers?.["x-cf-event-id"];

  return Array.isArray(key) ? key[0] : key;
}

function getBodyEventId(body) {
  const data = body?.data || {};
  const orderId = data.order_id || data.order?.order_id || data.payment?.order_id;
  const orderStatus =
    data.order_status ||
    data.payment_status ||
    data.payment?.payment_status;
  const refundId = data.refund?.refund_id;
  const refundStatus = data.refund?.refund_status;

  return (
    body?.event_id ||
    body?.cf_event_id ||
    data.event_id ||
    data.cf_event_id ||
    data.payment_details?.cf_payment_id ||
    data.payment?.cf_payment_id ||
    (refundId && `${refundId}:${refundStatus || "unknown"}`) ||
    (orderId && `${orderId}:${orderStatus || "unknown"}`)
  );
}

function getWebhookIdempotencyKey(headers, rawBody, body) {
  const explicitKey = getWebhookIdempotencyHeader(headers);
  const eventId = getBodyEventId(body);

  if (explicitKey) return String(explicitKey);
  if (eventId) return String(eventId);

  return crypto.createHash("sha256").update(toRawBody(rawBody)).digest("hex");
}

function getWebhookEventFields(body) {
  const data = body?.data || {};
  const orderId = data.order_id || data.order?.order_id || data.payment?.order_id;
  const paymentStatus =
    data.order_status ||
    data.payment_status ||
    data.payment?.payment_status;
  const refundId = data.refund?.refund_id;

  return {
    eventType: body?.type || body?.event_type || data.type || null,
    orderId: orderId || null,
    cfPaymentId:
      data.payment_details?.cf_payment_id ||
      data.payment?.cf_payment_id ||
      null,
    refundId: refundId || null,
    status: paymentStatus || data.refund?.refund_status || null,
  };
}

async function wasWebhookProcessed(idempotencyKey) {
  if (!idempotencyKey) return false;
  try {
    return Boolean(await redis.get(`cashfree:webhook:${idempotencyKey}`));
  } catch (err) {
    logger.warn("Cashfree webhook Redis idempotency lookup failed", {
      err,
      idempotencyKey,
    });
    return false;
  }
}

async function reserveWebhookProcessing(idempotencyKey) {
  if (!idempotencyKey) return true;

  try {
    const result = await redis.set(
      `cashfree:webhook-lock:${idempotencyKey}`,
      "1",
      {
        EX: WEBHOOK_PROCESSING_LOCK_TTL_SECONDS,
        NX: true,
      }
    );

    return result === "OK";
  } catch (err) {
    logger.warn("Cashfree webhook Redis lock unavailable; falling back to DB idempotency", {
      err,
      idempotencyKey,
    });
    return true;
  }
}

async function markWebhookProcessedInRedis(idempotencyKey) {
  if (!idempotencyKey) return;

  try {
    await redis.setEx(
      `cashfree:webhook:${idempotencyKey}`,
      WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
      "1"
    );
  } catch (err) {
    logger.warn("Cashfree webhook Redis processed mark failed", {
      err,
      idempotencyKey,
    });
  }
}

async function releaseWebhookProcessing(idempotencyKey) {
  if (!idempotencyKey) return;
  await redis.del(`cashfree:webhook-lock:${idempotencyKey}`);
}

async function recordWebhookAudit(event, processingStatus, options = {}) {
  await ensurePaymentHardeningSchema();
  await pool.query(
    `
    INSERT INTO cashfree_webhook_audit_log (
      idempotency_key,
      event_type,
      order_id,
      cf_payment_id,
      refund_id,
      processing_status,
      payload_hash,
      signature_present,
      webhook_timestamp,
      rejection_reason,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    `,
    [
      event?.idempotencyKey || null,
      event?.eventType || null,
      event?.orderId || null,
      event?.cfPaymentId || null,
      event?.refundId || null,
      processingStatus,
      event?.payloadHash || crypto.createHash("sha256").update("").digest("hex"),
      Boolean(event?.signature),
      event?.timestamp || null,
      options.rejectionReason || null,
      JSON.stringify(options.metadata || {}),
    ]
  );
}

async function recordWebhookAuditSafe(event, processingStatus, options = {}) {
  try {
    await recordWebhookAudit(event, processingStatus, options);
  } catch (err) {
    logger.warn("Cashfree webhook immutable audit write failed", {
      err,
      idempotencyKey: event?.idempotencyKey,
      processingStatus,
    });
  }
}

function reservationAttemptSnapshot(reservations) {
  return (reservations || []).map((reservation) => ({
    id: reservation.id,
    listing_id: reservation.listing_id,
    user_id: reservation.user_id,
    pickup_type: reservation.pickup_type,
    food_amount: roundMoney(reservation.food_amount),
    reliability_deposit_amount: roundMoney(
      reservation.reliability_deposit_amount
    ),
  }));
}

async function recordPaymentOrderAttempt({
  client = pool,
  orderId,
  user,
  reservations,
  amount,
  currency = "INR",
}) {
  const db = client || pool;
  await db.query(
    `
    INSERT INTO payment_order_attempts (
      order_id,
      payer_user_id,
      reservation_ids,
      amount,
      currency,
      status,
      reservation_snapshot
    )
    VALUES ($1,$2,$3::uuid[],$4,$5,'creating',$6::jsonb)
    ON CONFLICT (order_id)
    DO UPDATE SET updated_at=NOW()
    `,
    [
      orderId,
      user?.id || null,
      (reservations || []).map((reservation) => reservation.id),
      roundMoney(amount),
      currency,
      JSON.stringify(reservationAttemptSnapshot(reservations)),
    ]
  );
}

async function markPaymentOrderAttemptGatewayCreated({
  client = pool,
  orderId,
  paymentSessionId,
  gatewayResponse,
}) {
  const db = client || pool;
  await db.query(
    `
    UPDATE payment_order_attempts
    SET status='gateway_created',
        payment_session_id=$2,
        gateway_response=$3::jsonb,
        failure_reason=NULL,
        updated_at=NOW()
    WHERE order_id=$1
    `,
    [
      orderId,
      paymentSessionId || null,
      JSON.stringify(gatewayResponse || {}),
    ]
  );
}

async function markPaymentOrderAttemptDbInserted({ client = pool, orderId }) {
  const db = client || pool;
  await db.query(
    `
    UPDATE payment_order_attempts
    SET status='db_inserted',
        failure_reason=NULL,
        updated_at=NOW()
    WHERE order_id=$1
    AND status IN ('creating','gateway_created','recovery_pending')
    `,
    [orderId]
  );
}

async function markPaymentOrderAttemptCommitted({ orderId }) {
  await pool.query(
    `
    UPDATE payment_order_attempts
    SET status='committed',
        failure_reason=NULL,
        updated_at=NOW()
    WHERE order_id=$1
    AND status <> 'committed'
    `,
    [orderId]
  );
}

async function markPaymentOrderAttemptFailed({ client = pool, orderId, err }) {
  const db = client || pool;
  await db.query(
    `
    UPDATE payment_order_attempts
    SET status=CASE
          WHEN payment_session_id IS NULL THEN 'failed'
          ELSE 'recovery_pending'
        END,
        failure_reason=$2,
        updated_at=NOW()
    WHERE order_id=$1
    `,
    [orderId, String(err?.message || err || "unknown failure").slice(0, 1000)]
  );
}

async function reserveWebhookEvent(client, event) {
  const inserted = await client.query(
    `
    INSERT INTO cashfree_webhook_events (
      idempotency_key,
      event_type,
      order_id,
      cf_payment_id,
      refund_id,
      payload,
      payload_hash,
      signature,
      webhook_timestamp
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      event.idempotencyKey,
      event.eventType,
      event.orderId,
      event.cfPaymentId,
      event.refundId,
      JSON.stringify(event.body),
      event.payloadHash,
      event.signature || null,
      event.timestamp || null,
    ]
  );

  if (inserted.rows.length) return { shouldProcess: true, event: inserted.rows[0] };

  const existing = await client.query(
    `
    SELECT *
    FROM cashfree_webhook_events
    WHERE idempotency_key=$1
    FOR UPDATE
    `,
    [event.idempotencyKey]
  );

  const row = existing.rows[0];
  if (!row || row.status === "processed") {
    return { shouldProcess: false, event: row || null };
  }

  await client.query(
    `
    UPDATE cashfree_webhook_events
    SET status='processing',
        attempts=attempts + 1,
        received_at=NOW(),
        failure_reason=NULL
    WHERE idempotency_key=$1
    `,
    [event.idempotencyKey]
  );

  return { shouldProcess: true, event: row };
}

async function markWebhookEventProcessed(client, idempotencyKey) {
  await client.query(
    `
    UPDATE cashfree_webhook_events
    SET status='processed',
        processed_at=NOW(),
        failure_reason=NULL
    WHERE idempotency_key=$1
    `,
    [idempotencyKey]
  );
}

async function markWebhookEventFailed(event, err) {
  if (!event?.idempotencyKey) return;

  await ensurePaymentHardeningSchema();
  await pool.query(
    `
    INSERT INTO cashfree_webhook_events (
      idempotency_key,
      event_type,
      order_id,
      cf_payment_id,
      refund_id,
      status,
      payload,
      payload_hash,
      signature,
      webhook_timestamp,
      processed_at,
      failure_reason
    )
    VALUES ($1,$2,$3,$4,$5,'failed',$6::jsonb,$7,$8,$9,NOW(),$10)
    ON CONFLICT (idempotency_key)
    DO UPDATE SET status='failed',
                  attempts=cashfree_webhook_events.attempts + 1,
                  processed_at=NOW(),
                  failure_reason=EXCLUDED.failure_reason
    `,
    [
      event.idempotencyKey,
      event.eventType || null,
      event.orderId || null,
      event.cfPaymentId || null,
      event.refundId || null,
      JSON.stringify(event.body || {}),
      event.payloadHash,
      event.signature || null,
      event.timestamp || null,
      String(err?.message || err || "unknown failure").slice(0, 1000),
    ]
  );
}

async function restorePendingReservation(client, reservationId, paymentStatus) {
  const { reservation, payment } = await lockReservationGraph(client, reservationId, {
    lockPayments: true,
  });

  if (!reservation) return null;

  if (
    reservation.status !== "payment_pending" ||
    reservation.payment_status !== "pending"
  ) {
    return null;
  }

  if (
    ["paid", "success", "refund_pending", "refunded"].includes(
      String(payment?.status || "").toLowerCase()
    )
  ) {
    logger.payment("Skipped stale payment expiry because payment is already terminal", {
      reservationId,
      paymentId: payment?.id,
      paymentStatus: payment?.status,
    });
    return null;
  }

  await restoreReservationStockIfHeld(client, reservation, {
    reason: `payment_${paymentStatus || "terminal"}`,
  });

  const reservationStatus =
    paymentStatus === "expired" ? "expired_payment" : "payment_failed";

  await client.query(
    `
    UPDATE payments
    SET status=$2,
        gateway_status=$2,
        reconciliation_status='terminal',
        last_reconciled_at=NOW(),
        updated_at=NOW()
    WHERE reservation_id=$1
    AND status='pending'
    `,
    [reservationId, paymentStatus]
  );

  await client.query(
    `
    UPDATE reservations
    SET status=$2,
        payment_status=$3,
        payment_context=COALESCE(payment_context, '{}'::jsonb) ||
          jsonb_build_object('payment_terminal_at', NOW(), 'payment_terminal_source', 'gateway_reconciliation')
    WHERE id=$1
    AND status='payment_pending'
    AND payment_status='pending'
    `,
    [reservationId, reservationStatus, paymentStatus]
  );

  if (payment) {
    await prepareLifecycleAccounting({
      client,
      reservation,
      payment,
      terminalReason: "payment_timeout",
      lifecycleState: {
        outcome: "payment_timeout",
        refundType: "none",
      },
      actorContext: {
        role: "system",
      },
      metadata: {
        service: "paymentReconciliation.service",
        source: "restore_pending_reservation",
      },
    });
  }

  logger.info("Pending reservation restored after payment terminal state", {
    reservationId,
    listingId: reservation.listing_id,
    paymentStatus,
  });

  return reservation.listing_id;
}

async function activatePendingReservation(client, reservation) {
  const context = parsePaymentContext(reservation.payment_context);

  if (hasReservedStock(reservation)) {
    if (context.source === "ngo_request_accept" && context.request_id) {
      const requestResult = await client.query(
        `
        SELECT *
        FROM ngo_requests
        WHERE id=$1
        AND listing_id=$2
        FOR UPDATE
        `,
        [context.request_id, reservation.listing_id]
      );

      const request = requestResult.rows[0];
      if (!request || request.status !== "pending") {
        throw new Error("NGO request no longer available for paid reservation activation");
      }

      await client.query(
        `
        UPDATE ngo_requests
        SET status='accepted', responded_at=NOW()
        WHERE id=$1
        `,
        [context.request_id]
      );

      await client.query(
        `
        UPDATE ngo_requests
        SET status='expired', responded_at=NOW()
        WHERE listing_id=$1
        AND id != $2
        AND status='pending'
        `,
        [reservation.listing_id, context.request_id]
      );
    }

    const activated = await client.query(
      `
      UPDATE reservations
      SET payment_status='paid',
          status='reserved',
          pickup_code=COALESCE(pickup_code, $2),
          receive_code=COALESCE(receive_code, $3),
          payment_context=COALESCE(payment_context, '{}'::jsonb) || $4::jsonb
      WHERE id=$1
      AND status='payment_pending'
      AND payment_status='pending'
      RETURNING *
      `,
      [
        reservation.id,
        generatePickupCode(),
        generatePickupCode(),
        JSON.stringify({ activated_at: new Date().toISOString() }),
      ]
    );

    return activated.rowCount > 0 ? activated.rows[0] : null;
  }

  const listingResult = await client.query(
    `
    SELECT *
    FROM food_listings
    WHERE id=$1
    FOR UPDATE
    `,
    [reservation.listing_id]
  );

  const listing = listingResult.rows[0];
  if (!listing) {
    throw new Error("Listing not found for paid reservation activation");
  }

  if (String(listing.status || "active") !== "active") {
    throw new Error("Listing no longer available for paid reservation activation");
  }

  if (new Date(listing.pickup_end_time).getTime() <= Date.now()) {
    throw new Error("Pickup window ended before payment activation");
  }

  if (Number(listing.remaining_quantity) < Number(reservation.quantity_reserved)) {
    throw new Error("Insufficient inventory for paid reservation activation");
  }

  const duplicateReservation = await client.query(
    `
    SELECT id
    FROM reservations
    WHERE user_id=$1
    AND listing_id=$2
    AND id <> $3
    AND (
      status IN ('reserved', 'picked_up', 'completed')
      OR task_status IN ('assigned', 'in_progress', 'picked_from_provider', 'delivered')
      OR (
        status='cancelled'
        AND COALESCE(payment_status, '') IN (
          'paid',
          'not_required',
          'refund_pending',
          'refunded',
          'refund_failed'
        )
      )
    )
    LIMIT 1
    `,
    [reservation.user_id, reservation.listing_id, reservation.id]
  );

  if (duplicateReservation.rows.length) {
    throw new Error("User already has reservation for this listing");
  }

  if (context.source === "ngo_request_accept" && context.request_id) {
    const requestResult = await client.query(
      `
      SELECT *
      FROM ngo_requests
      WHERE id=$1
      AND listing_id=$2
      FOR UPDATE
      `,
      [context.request_id, reservation.listing_id]
    );

    const request = requestResult.rows[0];
    if (!request || request.status !== "pending") {
      throw new Error("NGO request no longer available for paid reservation activation");
    }
  }

  await reserveListingStock(client, {
    listingId: reservation.listing_id,
    quantity: reservation.quantity_reserved,
    completeWhenEmpty: context.source === "ngo_request_accept",
  });

  if (context.source === "ngo_request_accept" && context.request_id) {
    await client.query(
      `
      UPDATE ngo_requests
      SET status='accepted', responded_at=NOW()
      WHERE id=$1
      `,
      [context.request_id]
    );

    await client.query(
      `
      UPDATE ngo_requests
      SET status='expired', responded_at=NOW()
      WHERE listing_id=$1
      AND id != $2
      AND status='pending'
      `,
      [reservation.listing_id, context.request_id]
    );
  }

  const activated = await client.query(
    `
    UPDATE reservations
    SET payment_status='paid',
        status='reserved',
        pickup_code=COALESCE(pickup_code, $2),
        receive_code=COALESCE(receive_code, $3),
        payment_context=COALESCE(payment_context, '{}'::jsonb) || $4::jsonb
    WHERE id=$1
    AND status='payment_pending'
    AND payment_status='pending'
    RETURNING *
    `,
    [
      reservation.id,
      generatePickupCode(),
      generatePickupCode(),
      JSON.stringify({ stock_reserved: true, activated_at: new Date().toISOString() }),
    ]
  );

  return activated.rowCount > 0 ? activated.rows[0] : null;
}

async function processPaidOrder(client, orderId, paymentDetails = {}, sideEffects) {
  const { payments, reservationsById } = await lockPaymentGraphByOrderId(
    client,
    orderId
  );

  if (!payments.length) return;

  for (const payment of payments) {
    if (payment.status === "refunded") continue;

    const reservation = reservationsById.get(String(payment.reservation_id));

    if (!reservation) {
      await client.query(
        `
        UPDATE payments
        SET status='paid',
            gateway_status='PAID',
            payment_method=$1,
            transaction_id=COALESCE(transaction_id, $2),
            reconciliation_status='orphan_paid_missing_reservation',
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$3
        AND status <> 'refunded'
        `,
        [
          serializePaymentMethod(paymentDetails?.payment_method),
          paymentDetails?.cf_payment_id || null,
          payment.id,
        ]
      );
      logger.error("Paid payment has no reservation to finalize", {
        paymentId: payment.id,
        orderId,
        reservationId: payment.reservation_id,
      });
      void recordAlert({
        alertKey: "payment:orphan_paid_missing_reservation",
        category: "payment",
        severity: "error",
        message: "Paid payment missing reservation",
        metadata: {
          paymentId: payment.id,
          orderId,
          reservationId: payment.reservation_id,
        },
      });
      continue;
    }
    if (reservation.payment_status === "refunded") continue;

    const alreadyFinalPaid =
      payment.status === "paid" && reservation.payment_status === "paid";

    if (
      !alreadyFinalPaid &&
      ([
        "cancelled",
        "cancelled_before_confirmation",
        "expired_payment",
        "payment_failed",
        "failed",
      ].includes(reservation.status) ||
        refundedPaymentStates.has(payment.status) ||
        refundedPaymentStates.has(reservation.payment_status))
    ) {
      if (payment.status !== "refund_pending") {
        await client.query(
          `
          UPDATE payments
          SET status='refund_pending',
              refund_status='refund_pending',
              gateway_status='paid_after_cancellation',
              last_reconciled_at=NOW(),
              updated_at=NOW()
          WHERE id=$1
          AND status <> 'refunded'
          `,
          [payment.id]
        );
      }

      await client.query(
        `
        UPDATE reservations
        SET status = CASE
              WHEN status IN ('cancelled_before_confirmation', 'expired_payment', 'payment_failed', 'failed')
              THEN 'cancelled'
              ELSE status
            END,
            payment_status='refund_pending'
        WHERE id=$1
        AND payment_status NOT IN ('refunded', 'refund_failed')
        `,
        [payment.reservation_id]
      );

      sideEffects.refundReservationIds.push(payment.reservation_id);
      sideEffects.changedReservationIds.add(payment.reservation_id);
      continue;
    }

    if (
      alreadyFinalPaid &&
      reservation.status !== "payment_pending"
    ) {
      continue;
    }

    await client.query(
      `
      UPDATE payments
      SET status='paid',
          gateway_status='PAID',
          payment_method=$1,
          transaction_id=COALESCE(transaction_id, $2),
          reconciliation_status='terminal',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$3
      `,
      [
        serializePaymentMethod(paymentDetails?.payment_method),
        paymentDetails?.cf_payment_id || null,
        payment.id,
      ]
    );

    let activated = null;
    try {
      if (
        reservation.status === "payment_pending" &&
        reservation.payment_status === "pending"
      ) {
        activated = await activatePendingReservation(client, reservation);
      } else if (
        reservation.status === "reserved" &&
        reservation.payment_status === "paid"
      ) {
        activated = reservation;
      } else if (
        reservation.status === "reserved" &&
        reservation.payment_status !== "paid"
      ) {
        const repaired = await client.query(
          `
          UPDATE reservations
          SET payment_status='paid',
              pickup_code=COALESCE(pickup_code, $2),
              receive_code=COALESCE(receive_code, $3),
              payment_context=COALESCE(payment_context, '{}'::jsonb) ||
                jsonb_build_object('paid_recovered_at', NOW(), 'paid_recovery_source', 'payment_reconciliation')
          WHERE id=$1
          AND status='reserved'
          AND payment_status <> 'paid'
          RETURNING *
          `,
          [reservation.id, generatePickupCode(), generatePickupCode()]
        );
        activated = repaired.rows[0] || null;
      } else {
        throw new Error(
          `Reservation state cannot be finalized from ${reservation.status}/${reservation.payment_status}`
        );
      }
    } catch (err) {
      logger.error("Paid reservation activation failed", {
        err,
        reservationId: payment.reservation_id,
        orderId,
      });

      await client.query(
        `
        UPDATE payments
        SET status='refund_pending',
            refund_status='refund_pending',
            reconciliation_status='activation_failed_refund_pending',
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        AND status <> 'refunded'
        `,
        [payment.id]
      );

      await client.query(
        `
        UPDATE reservations
        SET status='cancelled',
            payment_status='refund_pending'
        WHERE id=$1
        AND payment_status <> 'refunded'
        `,
        [payment.reservation_id]
      );

      sideEffects.refundReservationIds.push(payment.reservation_id);
      sideEffects.changedReservationIds.add(payment.reservation_id);
      continue;
    }

    if (!activated) {
      logger.error("Paid reservation activation produced no state transition", {
        reservationId: payment.reservation_id,
        orderId,
        reservationStatus: reservation.status,
        reservationPaymentStatus: reservation.payment_status,
      });
      await client.query(
        `
        UPDATE payments
        SET status='refund_pending',
            refund_status='refund_pending',
            reconciliation_status='activation_missing_refund_pending',
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        AND status <> 'refunded'
        `,
        [payment.id]
      );
      await client.query(
        `
        UPDATE reservations
        SET status='cancelled',
            payment_status='refund_pending'
        WHERE id=$1
        AND payment_status <> 'refunded'
        `,
        [payment.reservation_id]
      );
      sideEffects.refundReservationIds.push(payment.reservation_id);
      sideEffects.changedReservationIds.add(payment.reservation_id);
      continue;
    }

    if (activated) {
      await recordSettlementAllocation({
        client,
        payment: {
          ...payment,
          status: "paid",
          gateway_status: "PAID",
          transaction_id: paymentDetails?.cf_payment_id || payment.transaction_id,
          payment_method: serializePaymentMethod(paymentDetails?.payment_method),
        },
        metadata: {
          source: "payment_reconciliation",
          order_id: orderId,
          activated: reservation.status === "payment_pending",
        },
      }).catch((err) => {
        logger.error("F4 settlement allocation recording failed", {
          err,
          reservationId: payment.reservation_id,
          paymentId: payment.id,
          orderId,
        });
        void recordAlert({
          alertKey: `financial:f4:settlement_allocation_failed:${payment.id}`,
          category: "payment",
          severity: "error",
          message: "F4 settlement allocation recording failed",
          metadata: {
            reservationId: payment.reservation_id,
            paymentId: payment.id,
            orderId,
            message: err?.message,
          },
        });
      });
      sideEffects.changedReservationIds.add(payment.reservation_id);
      if (reservation.status === "payment_pending") {
        sideEffects.activatedReservationIds.add(payment.reservation_id);
      }
      sideEffects.changedListingIds.add(reservation.listing_id);
      logger.info("Payment finalized reservation", {
        reservationId: payment.reservation_id,
        orderId,
        listingId: reservation.listing_id,
      });
    }
  }
}

async function processFailedOrder(client, orderId, orderStatus, sideEffects) {
  const paymentStatus = normalizeFailedStatus(orderStatus);
  const { payments } = await lockPaymentGraphByOrderId(client, orderId);

  for (const payment of payments) {
    if (
      ["paid", "success", "refunded", "refund_pending"].includes(payment.status)
    ) continue;

    const restoredListingId = await restorePendingReservation(
      client,
      payment.reservation_id,
      paymentStatus
    );
    if (restoredListingId) {
      sideEffects.changedListingIds.add(restoredListingId);
      sideEffects.changedReservationIds.add(payment.reservation_id);
    }
  }
}

async function processRefundEvent(client, refund, sideEffects, options = {}) {
  const { refund_id } = refund || {};
  const refund_status = String(refund?.refund_status || "").toUpperCase();
  const normalizedRefundStatus = normalizeRefundStatusFromGateway(refund_status);
  if (!refund_id) return;

  const paymentRef = await client.query(
    `
    SELECT id, reservation_id
    FROM payments
    WHERE refund_id=$1 OR reliability_deposit_refund_id=$1
    ORDER BY id
    LIMIT 1
    `,
    [refund_id]
  );

  if (!paymentRef.rows.length) return;

  const ref = paymentRef.rows[0];
  let payment = null;

  if (ref.reservation_id) {
    const locked = await lockReservationGraph(client, ref.reservation_id, {
      lockPayments: true,
    });
    payment =
      locked.payments.find((row) => String(row.id) === String(ref.id)) ||
      locked.payment;
  } else {
    payment = await lockPaymentById(client, ref.id);
  }

  if (!payment) return;

  const isDepositRefund = payment.reliability_deposit_refund_id === refund_id;

  if (isDepositRefund) {
    if (
      !shouldApplyRefundWebhook({
        currentStatus: payment.reliability_deposit_status,
        incomingStatus: normalizedRefundStatus,
        allowRetryTransition: options.allowRetryTransition,
      })
    ) {
      logger.payment("Stale reliability deposit refund webhook ignored", {
        reservationId: payment.reservation_id,
        paymentId: payment.id,
        refundId: refund_id,
        currentStatus: payment.reliability_deposit_status,
        incomingStatus: normalizedRefundStatus,
      });
      return;
    }

    if (normalizedRefundStatus === "refunded") {
      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refunded',
            reliability_deposit_refunded_at=NOW(),
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        `,
        [payment.id]
      );
      await markFinancialOperationStatusByRefundId({
        client,
        refundId: refund_id,
        status: "succeeded",
        metadata: { gateway_status: refund_status, source: "cashfree_webhook" },
      });
      sideEffects.changedReservationIds.add(payment.reservation_id);
      return;
    }

    if (normalizedRefundStatus === "refund_failed") {
      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refund_failed',
            last_reconciled_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        AND reliability_deposit_status <> 'refunded'
        `,
        [payment.id]
      );
      await markFinancialOperationStatusByRefundId({
        client,
        refundId: refund_id,
        status: "failed",
        metadata: { gateway_status: refund_status, source: "cashfree_webhook" },
      });
      sideEffects.changedReservationIds.add(payment.reservation_id);
      return;
    }

    await client.query(
      `
      UPDATE payments
      SET reliability_deposit_status='refund_pending',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      AND reliability_deposit_status <> 'refunded'
      `,
      [payment.id]
    );
    await markFinancialOperationStatusByRefundId({
      client,
      refundId: refund_id,
      status: "processing",
      metadata: { gateway_status: refund_status, source: "cashfree_webhook" },
    });
    sideEffects.changedReservationIds.add(payment.reservation_id);
    return;
  }

  if (
    !shouldApplyRefundWebhook({
      currentStatus: payment.refund_status || payment.status,
      incomingStatus: normalizedRefundStatus,
      allowRetryTransition: options.allowRetryTransition,
    }) ||
    payment.status === "refunded"
  ) {
    logger.payment("Stale payment refund webhook ignored", {
      reservationId: payment.reservation_id,
      paymentId: payment.id,
      refundId: refund_id,
      currentStatus: payment.refund_status || payment.status,
      incomingStatus: normalizedRefundStatus,
    });
    return;
  }

  if (normalizedRefundStatus === "refunded") {
    await client.query(
      `
      UPDATE payments
      SET status='refunded',
          refund_status='refunded',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      `,
      [payment.id]
    );

    await client.query(
      `UPDATE reservations SET payment_status='refunded' WHERE id=$1`,
      [payment.reservation_id]
    );
    await markFinancialOperationStatusByRefundId({
      client,
      refundId: refund_id,
      status: "succeeded",
      metadata: { gateway_status: refund_status, source: "cashfree_webhook" },
    });
    sideEffects.changedReservationIds.add(payment.reservation_id);
    return;
  }

  if (normalizedRefundStatus === "refund_failed") {
    await client.query(
      `
      UPDATE payments
      SET status='refund_failed',
          refund_status='refund_failed',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      `,
      [payment.id]
    );

    await client.query(
      `
      UPDATE reservations
      SET payment_status='refund_failed'
      WHERE id=$1
      AND payment_status <> 'refunded'
      `,
      [payment.reservation_id]
    );
    await markFinancialOperationStatusByRefundId({
      client,
      refundId: refund_id,
      status: "failed",
      metadata: { gateway_status: refund_status, source: "cashfree_webhook" },
    });
    sideEffects.changedReservationIds.add(payment.reservation_id);
    return;
  }

  if (!refundedPaymentStates.has(payment.status)) {
    await client.query(
      `
      UPDATE payments
      SET status='refund_pending',
          refund_status='refund_pending',
          last_reconciled_at=NOW(),
          updated_at=NOW()
      WHERE id=$1
      `,
      [payment.id]
    );

    await client.query(
      `
      UPDATE reservations
      SET payment_status='refund_pending'
      WHERE id=$1
      AND payment_status NOT IN ('refunded', 'refund_failed')
      `,
      [payment.reservation_id]
    );
    await markFinancialOperationStatusByRefundId({
      client,
      refundId: refund_id,
      status: operationStatusFromRefundStatus("refund_pending"),
      metadata: { gateway_status: refund_status, source: "cashfree_webhook" },
    });
    sideEffects.changedReservationIds.add(payment.reservation_id);
  }
}

function createSideEffects() {
  return {
    refundReservationIds: [],
    changedReservationIds: new Set(),
    activatedReservationIds: new Set(),
    changedListingIds: new Set(),
  };
}

async function publishSideEffects(sideEffects, action = "payment_changed") {
  await Promise.all([
    ...[...sideEffects.changedListingIds].map((listingId) =>
      publishListingUpdated(listingId, { action: "quantity_updated" })
    ),
    ...[...sideEffects.changedReservationIds].map(async (reservationId) => {
      const reservation = await getReservationSnapshot(reservationId);
      await Promise.all([
        publishReservationUpdated(reservationId, {
          action,
          reservation,
        }),
        publishPaymentUpdated(reservationId, {
          action,
          reservation,
        }),
        reservation?.pickup_type === "ngo" &&
        reservation?.status === "reserved" &&
        reservation?.task_status === "pending"
          ? publishTaskAvailabilityUpdated(reservationId, {
              action: "available",
              reservation,
            })
          : Promise.resolve(),
        reservation?.listing_id
          ? publishListingUpdated(reservation.listing_id, {
              action: "quantity_updated",
            })
          : Promise.resolve(),
        sideEffects.activatedReservationIds.has(reservationId) &&
        reservation?.provider_id
          ? notificationQueue
              .add("notify-user", {
                userId: reservation.provider_id,
                type: "reservation_created",
                title:
                  reservation.pickup_type === "ngo"
                    ? "New NGO Reservation"
                    : "New Reservation",
                message:
                  reservation.pickup_type === "ngo"
                    ? "An NGO reserved food for pickup."
                    : "A new reservation has been placed.",
                data: {
                  reservation_id: reservationId,
                  listing_id: reservation.listing_id,
                },
              })
              .catch((err) => {
                logger.warn("Provider paid reservation notification failed", {
                  err,
                  reservationId,
                  providerId: reservation.provider_id,
                });
              })
          : Promise.resolve(),
      ]);
    }),
  ]);

  try {
    await Promise.all(
      sideEffects.refundReservationIds.map((reservationId) =>
        refundQueue.add(
          "refund-payment",
          { reservationId, operationSource: "reconciliation" },
          jobOptions("critical", {
            jobId: `refund-${reservationId}`,
          })
        )
      )
    );
  } catch (err) {
    logger.error("Failed to enqueue payment reconciliation refund", { err });
  }
}

async function processCashfreePayload(client, body, sideEffects) {
  const data = body?.data || {};
  const orderId = data.order_id || data.order?.order_id || data.payment?.order_id;

  if (orderId) {
    const orderStatus = String(
      data.order_status ||
        data.payment_status ||
        data.payment?.payment_status ||
        ""
    ).toUpperCase();
    const paymentDetails = data.payment_details || data.payment || {};

    if (paidStatuses.has(orderStatus)) {
      await processPaidOrder(client, orderId, paymentDetails, sideEffects);
    } else if (failedStatuses.has(orderStatus)) {
      await processFailedOrder(client, orderId, orderStatus, sideEffects);
    }
  }

  if (data.refund) {
    await processRefundEvent(client, data.refund, sideEffects);
  }
}

async function handleCashfreeWebhook({ headers, rawBody }) {
  const signature = getHeaderValue(headers, "x-webhook-signature");
  const timestamp = getHeaderValue(headers, "x-webhook-timestamp");
  const rawBuffer = toRawBody(rawBody);
  const payloadHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
  recordPaymentEvent({
    eventName: "cashfree_webhook_received",
    status: "received",
  });

  try {
    verifyCashfreeWebhookSignature({ rawBody: rawBuffer, signature, timestamp });
  } catch (err) {
    await recordWebhookAuditSafe(
      {
        idempotencyKey: payloadHash,
        payloadHash,
        signature,
        timestamp,
      },
      "rejected",
      {
        rejectionReason: err?.message,
        metadata: { phase: "signature_verification" },
      }
    );
    throw err;
  }

  logger.payment("Cashfree webhook signature verified", {
    hasSignature: Boolean(signature),
    hasTimestamp: Boolean(timestamp),
  });

  let body;
  try {
    body = JSON.parse(rawBodyToString(rawBuffer));
  } catch (err) {
    err.statusCode = 400;
    await recordWebhookAuditSafe(
      {
        idempotencyKey: payloadHash,
        payloadHash,
        signature,
        timestamp,
      },
      "rejected",
      {
        rejectionReason: "Invalid Cashfree webhook JSON payload",
        metadata: { phase: "json_parse" },
      }
    );
    throw err;
  }

  const idempotencyKey = getWebhookIdempotencyKey(headers, rawBuffer, body);
  const fields = getWebhookEventFields(body);
  const eventRecord = {
    idempotencyKey,
    body,
    payloadHash,
    signature,
    timestamp,
    ...fields,
  };
  let processingReserved = false;
  let duplicate = false;
  const sideEffects = createSideEffects();

  try {
    await recordWebhookAuditSafe(eventRecord, "received");

    if (await wasWebhookProcessed(idempotencyKey)) {
      logger.payment("Cashfree webhook replay ignored from Redis idempotency cache", {
        idempotencyKey,
        orderId: fields.orderId,
        refundId: fields.refundId,
      });
      await recordWebhookAuditSafe(eventRecord, "duplicate", {
        metadata: { source: "redis_idempotency_cache" },
      });
      return { duplicate: true };
    }

    processingReserved = await reserveWebhookProcessing(idempotencyKey);
    if (!processingReserved) {
      logger.payment("Concurrent Cashfree webhook replay ignored", {
        idempotencyKey,
        orderId: fields.orderId,
        refundId: fields.refundId,
      });
      await recordWebhookAuditSafe(eventRecord, "concurrent_duplicate", {
        metadata: { source: "redis_processing_lock" },
      });
      return { duplicate: true };
    }

    await withTransaction(
      pool,
      async (client) => {
        await ensurePaymentHardeningSchema(client);

        const reservedEvent = await reserveWebhookEvent(client, eventRecord);

        if (!reservedEvent.shouldProcess) {
          duplicate = true;
          return;
        }

        await processCashfreePayload(client, body, sideEffects);
        await markWebhookEventProcessed(client, idempotencyKey);
      },
      {
        name: "cashfree_webhook",
        maxAttempts: 4,
        lockTimeoutMs: 2500,
        statementTimeoutMs: 20000,
      }
    );

    await markWebhookProcessedInRedis(idempotencyKey);
    if (duplicate) {
      logger.payment("Cashfree webhook replay ignored from database idempotency log", {
        idempotencyKey,
        orderId: fields.orderId,
        refundId: fields.refundId,
      });
      await recordWebhookAuditSafe(eventRecord, "duplicate", {
        metadata: { source: "database_idempotency_log" },
      });
      return { duplicate: true };
    }

    await publishSideEffects(sideEffects);

    logger.payment("Cashfree webhook processed", {
      idempotencyKey,
      orderId: fields.orderId,
      refundId: fields.refundId,
      status: fields.status,
    });
    void recordOperationalEvent({
      category: "payment",
      severity: "info",
      eventName: "cashfree_webhook_processed",
      metadata: {
        idempotencyKey,
        orderId: fields.orderId,
        refundId: fields.refundId,
        status: fields.status,
      },
    });
    await recordWebhookAuditSafe(eventRecord, "processed", {
      metadata: { status: fields.status },
    });

    return { duplicate: false };
  } catch (err) {
    void recordOperationalEvent({
      category: "payment",
      severity: "error",
      eventName: "cashfree_webhook_failed",
      metadata: {
        idempotencyKey,
        orderId: fields.orderId,
        refundId: fields.refundId,
        status: fields.status,
        message: err?.message,
      },
    });
    void recordAlert({
      alertKey: "payment:webhook_failure",
      category: "payment",
      severity: "error",
      message: "Cashfree webhook failure",
      metadata: { orderId: fields.orderId, message: err?.message },
    });
    await markWebhookEventFailed(eventRecord, err).catch((markErr) => {
      logger.warn("Cashfree webhook failure mark failed", { err: markErr });
    });
    await recordWebhookAuditSafe(eventRecord, "failed", {
      rejectionReason: err?.message,
      metadata: { status: fields.status },
    });
    throw err;
  } finally {
    if (processingReserved) {
      await releaseWebhookProcessing(idempotencyKey).catch((err) => {
        logger.warn("Cashfree webhook lock cleanup failed", { err });
      });
    }
  }
}

function normalizePaymentStatusFromGateway(order, payments = []) {
  const orderStatus = String(order?.order_status || "").toUpperCase();
  const successfulPayment = payments.find((payment) =>
    paidStatuses.has(String(payment.payment_status || "").toUpperCase())
  );

  if (successfulPayment || paidStatuses.has(orderStatus)) {
    return {
      status: "PAID",
      paymentDetails: successfulPayment || {},
    };
  }

  const failedPayment = payments.find((payment) =>
    failedStatuses.has(String(payment.payment_status || "").toUpperCase())
  );

  if (failedPayment) {
    return {
      status: String(failedPayment.payment_status || "FAILED").toUpperCase(),
      paymentDetails: failedPayment,
    };
  }

  if (failedStatuses.has(orderStatus)) {
    return {
      status: orderStatus,
      paymentDetails: {},
    };
  }

  return {
    status: orderStatus || "PENDING",
    paymentDetails: {},
  };
}

async function fetchCashfreeOrderState(orderId) {
  const [orderResponse, paymentsResponse] = await Promise.all([
    cashfree.PGFetchOrder(orderId),
    cashfree.PGOrderFetchPayments(orderId).catch((err) => {
      logger.warn("Cashfree payment fetch failed during reconciliation", {
        err,
        orderId,
      });
      return { data: [] };
    }),
  ]);

  const payments = Array.isArray(paymentsResponse.data) ? paymentsResponse.data : [];
  return normalizePaymentStatusFromGateway(orderResponse.data || {}, payments);
}

async function reconcileOrder({ orderId, source = "manual" }) {
  const gateway = await fetchCashfreeOrderState(orderId);
  const sideEffects = createSideEffects();

  try {
    await withTransaction(
      pool,
      async (client) => {
        await ensurePaymentHardeningSchema(client);

        if (paidStatuses.has(gateway.status)) {
          await processPaidOrder(client, orderId, gateway.paymentDetails, sideEffects);
        } else if (failedStatuses.has(gateway.status)) {
          await processFailedOrder(client, orderId, gateway.status, sideEffects);
        } else {
          await client.query(
            `
            UPDATE payments
            SET gateway_status=$2,
                reconciliation_status='pending_gateway',
                reconciliation_attempts=COALESCE(reconciliation_attempts, 0) + 1,
                last_reconciled_at=NOW(),
                updated_at=NOW()
            WHERE order_id=$1
            AND status='pending'
            `,
            [orderId, gateway.status]
          );
        }
      },
      {
        name: `payment_reconcile:${source}`,
        maxAttempts: 4,
        lockTimeoutMs: 2500,
        statementTimeoutMs: 20000,
      }
    );

    await publishSideEffects(sideEffects, "payment_reconciled");

    logger.payment("Payment order reconciled", {
      orderId,
      source,
      gatewayStatus: gateway.status,
      changedReservations: sideEffects.changedReservationIds.size,
    });
    void recordOperationalEvent({
      category: "payment",
      severity: "info",
      eventName: "payment_order_reconciled",
      metadata: {
        orderId,
        source,
        gatewayStatus: gateway.status,
        changedReservations: sideEffects.changedReservationIds.size,
      },
    });

    return {
      orderId,
      gatewayStatus: gateway.status,
      changedReservations: sideEffects.changedReservationIds.size,
    };
  } catch (err) {
    logger.error("Payment order reconciliation failed", { err, orderId, source });
    void recordAlert({
      alertKey: "payment:reconciliation_failure",
      category: "payment",
      severity: "error",
      message: "Payment reconciliation failed",
      metadata: { orderId, source, message: err?.message },
    });
    throw err;
  }
}

function parseJsonValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function attemptReservationIds(attempt) {
  if (Array.isArray(attempt?.reservation_ids)) return attempt.reservation_ids;
  return [];
}

function attemptIsOlderThan(attempt, minutes) {
  const updatedAt = new Date(attempt?.updated_at || attempt?.created_at || 0);
  return Date.now() - updatedAt.getTime() > minutes * 60 * 1000;
}

async function claimRecoverablePaymentOrderAttempts(limit) {
  const result = await pool.query(
    `
    UPDATE payment_order_attempts
    SET status='recovery_pending',
        recovery_attempts=recovery_attempts + 1,
        updated_at=NOW()
    WHERE id IN (
      SELECT id
      FROM payment_order_attempts
      WHERE (
        (
          status IN ('db_inserted','recovery_pending','failed')
          AND updated_at < NOW() - INTERVAL '2 minutes'
        )
        OR (
          status IN ('creating','gateway_created')
          AND updated_at < NOW() - INTERVAL '10 minutes'
        )
      )
      ORDER BY updated_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
    `,
    [limit]
  );

  return result.rows;
}

async function paymentRowsExistForAttempt(attempt) {
  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM payments
    WHERE order_id=$1
    `,
    [attempt.order_id]
  );

  return Number(result.rows[0]?.count || 0) > 0;
}

async function restoreAttemptReservationsWithoutPaymentRows(attempt, reason) {
  const sideEffects = createSideEffects();
  const ids = attemptReservationIds(attempt);

  await withTransaction(
    pool,
    async (client) => {
      await ensurePaymentHardeningSchema(client);

      for (const reservationId of ids) {
        const existingPayment = await client.query(
          `
          SELECT id
          FROM payments
          WHERE reservation_id=$1 OR order_id=$2
          LIMIT 1
          `,
          [reservationId, attempt.order_id]
        );

        if (existingPayment.rows.length) continue;

        const { reservation } = await lockReservationGraph(client, reservationId, {
          lockPayments: false,
        });

        if (
          !reservation ||
          reservation.status !== "payment_pending" ||
          reservation.payment_status !== "pending"
        ) {
          continue;
        }

        await restoreReservationStockIfHeld(client, reservation, { reason });
        await client.query(
          `
          UPDATE reservations
          SET status='payment_failed',
              payment_status='failed',
              payment_context=COALESCE(payment_context, '{}'::jsonb) ||
                jsonb_build_object(
                  'payment_terminal_at', NOW(),
                  'payment_terminal_source', $2::text,
                  'recovered_order_id', $3::text
                )
          WHERE id=$1
          AND status='payment_pending'
          AND payment_status='pending'
          `,
          [reservationId, reason, attempt.order_id]
        );

        sideEffects.changedReservationIds.add(reservationId);
        sideEffects.changedListingIds.add(reservation.listing_id);
      }

      await client.query(
        `
        UPDATE payment_order_attempts
        SET status='abandoned',
            failure_reason=$2,
            recovered_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        `,
        [attempt.id, reason]
      );
    },
    {
      name: "payment_order_attempt_restore",
      maxAttempts: 4,
      lockTimeoutMs: 2500,
      statementTimeoutMs: 20000,
    }
  );

  await publishSideEffects(sideEffects, "payment_recovery");

  return {
    orderId: attempt.order_id,
    restoredReservations: sideEffects.changedReservationIds.size,
  };
}

async function materializeMissingPaymentsForAttempt(attempt, paymentDetails = {}) {
  const sideEffects = createSideEffects();
  const snapshotRows = parseJsonValue(attempt.reservation_snapshot, []);
  const snapshotById = new Map(
    (Array.isArray(snapshotRows) ? snapshotRows : []).map((row) => [
      String(row.id),
      row,
    ])
  );

  await withTransaction(
    pool,
    async (client) => {
      await ensurePaymentHardeningSchema(client);

      const existing = await client.query(
        `
        SELECT id
        FROM payments
        WHERE order_id=$1
        LIMIT 1
        `,
        [attempt.order_id]
      );
      if (existing.rows.length) {
        await client.query(
          `
          UPDATE payment_order_attempts
          SET status='committed',
              recovered_at=COALESCE(recovered_at, NOW()),
              updated_at=NOW()
          WHERE id=$1
          `,
          [attempt.id]
        );
        return;
      }

      const payerResult = attempt.payer_user_id
        ? await client.query(`SELECT * FROM users WHERE id=$1`, [
            attempt.payer_user_id,
          ])
        : { rows: [] };
      const payer = payerResult.rows[0] || null;

      for (const reservationId of attemptReservationIds(attempt)) {
        const { reservation } = await lockReservationGraph(client, reservationId, {
          lockPayments: false,
        });

        if (!reservation) continue;

        const item = snapshotById.get(String(reservationId)) || {};
        const foodAmount = roundMoney(item.food_amount);
        const depositAmount = roundMoney(item.reliability_deposit_amount);
        const amount = roundMoney(foodAmount + depositAmount);

        const inserted = await client.query(
          `
          INSERT INTO payments (
            reservation_id,
            order_id,
            payment_session_id,
            amount,
            status,
            food_amount,
            reliability_deposit_amount,
            reliability_deposit_status,
            reconciliation_status
          )
          VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,'recovered_missing_payment_row')
          RETURNING *
          `,
          [
            reservationId,
            attempt.order_id,
            attempt.payment_session_id,
            amount,
            foodAmount,
            depositAmount,
            depositAmount > 0 ? "held" : "not_required",
          ]
        );

        await createFinancialOwnershipSnapshot({
          client,
          user:
            payer ||
            {
              id: attempt.payer_user_id || reservation.user_id,
              role: reservation.pickup_type === "ngo" ? "ngo" : "user",
            },
          payer:
            payer ||
            {
              id: attempt.payer_user_id || reservation.user_id,
              role: reservation.pickup_type === "ngo" ? "ngo" : "user",
            },
          reservation,
          payment: inserted.rows[0],
          foodAmount,
          depositAmount,
          currency: attempt.currency || "INR",
          sourceMetadata: {
            order_id: attempt.order_id,
            payment_session_id: attempt.payment_session_id,
            recovery_source: "payment_order_attempt",
          },
        });
      }

      await processPaidOrder(
        client,
        attempt.order_id,
        paymentDetails,
        sideEffects
      );

      await client.query(
        `
        UPDATE payment_order_attempts
        SET status='recovered',
            failure_reason=NULL,
            recovered_at=NOW(),
            updated_at=NOW()
        WHERE id=$1
        `,
        [attempt.id]
      );
    },
    {
      name: "payment_order_attempt_materialize",
      maxAttempts: 4,
      lockTimeoutMs: 2500,
      statementTimeoutMs: 30000,
    }
  );

  await publishSideEffects(sideEffects, "payment_recovered");

  return {
    orderId: attempt.order_id,
    recoveredPayments: attemptReservationIds(attempt).length,
  };
}

async function recoverPaymentOrderAttempt(attempt) {
  if (await paymentRowsExistForAttempt(attempt)) {
    await markPaymentOrderAttemptCommitted({ orderId: attempt.order_id });
    return {
      orderId: attempt.order_id,
      status: "committed",
      recovered: false,
    };
  }

  if (!attempt.payment_session_id) {
    if (attemptIsOlderThan(attempt, 10)) {
      return restoreAttemptReservationsWithoutPaymentRows(
        attempt,
        "payment_order_creation_crash"
      );
    }

    return {
      orderId: attempt.order_id,
      status: "creating",
      recovered: false,
    };
  }

  let gateway;
  try {
    gateway = await fetchCashfreeOrderState(attempt.order_id);
  } catch (err) {
    logger.error("Payment order attempt gateway recovery failed", {
      err,
      orderId: attempt.order_id,
    });

    if (attemptIsOlderThan(attempt, 10)) {
      await recordAlert({
        alertKey: `payment:order_attempt_gateway_unknown:${attempt.order_id}`,
        category: "payment",
        severity: "error",
        message: "Payment order attempt has no local rows and gateway state is unknown",
        metadata: { orderId: attempt.order_id, message: err?.message },
      });
    }

    await pool.query(
      `
      UPDATE payment_order_attempts
      SET failure_reason=$2,
          updated_at=NOW()
      WHERE id=$1
      `,
      [
        attempt.id,
        String(err?.message || err || "gateway recovery failed").slice(0, 1000),
      ]
    );
    return {
      orderId: attempt.order_id,
      status: "gateway_unknown",
      recovered: false,
    };
  }

  if (paidStatuses.has(gateway.status)) {
    return materializeMissingPaymentsForAttempt(
      attempt,
      gateway.paymentDetails || {}
    );
  }

  if (failedStatuses.has(gateway.status)) {
    return restoreAttemptReservationsWithoutPaymentRows(
      attempt,
      `gateway_${String(gateway.status || "failed").toLowerCase()}`
    );
  }

  await pool.query(
    `
    UPDATE payment_order_attempts
    SET failure_reason=NULL,
        updated_at=NOW()
    WHERE id=$1
    `,
    [attempt.id]
  );

  return {
    orderId: attempt.order_id,
    status: "pending_gateway",
    recovered: false,
  };
}

async function recoverPaymentOrderAttempts(options = {}) {
  const limit = options.limit || PAYMENT_ORDER_ATTEMPT_RECOVERY_LIMIT;
  await ensurePaymentHardeningSchema();

  const attempts = await claimRecoverablePaymentOrderAttempts(limit);
  const results = [];

  for (const attempt of attempts) {
    try {
      results.push(await recoverPaymentOrderAttempt(attempt));
    } catch (err) {
      logger.error("Payment order attempt recovery item failed", {
        err,
        orderId: attempt.order_id,
      });
      void recordOperationalEvent({
        category: "payment",
        severity: "error",
        eventName: "payment_order_attempt_recovery_failed",
        metadata: { orderId: attempt.order_id, message: err?.message },
      });
    }
  }

  return results;
}

async function fetchCashfreeRefundState(orderId, refundId) {
  if (!orderId || !refundId) return null;

  if (typeof cashfree.PGOrderFetchRefund === "function") {
    const response = await cashfree.PGOrderFetchRefund(orderId, refundId);
    return response.data || null;
  }

  if (typeof cashfree.PGOrderFetchRefunds === "function") {
    const response = await cashfree.PGOrderFetchRefunds(orderId);
    const refunds = Array.isArray(response.data) ? response.data : [];
    return (
      refunds.find((refund) => String(refund.refund_id) === String(refundId)) ||
      null
    );
  }

  logger.warn("Cashfree SDK does not expose refund fetch API; refund reconciliation deferred", {
    orderId,
    refundId,
  });
  return null;
}

async function reconcileRefundAgainstGateway({
  orderId,
  refundId,
  source = "manual",
}) {
  const refund = await fetchCashfreeRefundState(orderId, refundId);

  if (!refund?.refund_status) {
    void recordOperationalEvent({
      category: "payment",
      severity: "warning",
      eventName: "refund_gateway_state_unknown",
      metadata: { orderId, refundId, source },
    });
    return {
      orderId,
      refundId,
      gatewayStatus: "UNKNOWN",
      resolved: false,
    };
  }

  const sideEffects = createSideEffects();
  await withTransaction(
    pool,
    async (client) => {
      await ensurePaymentHardeningSchema(client);
      await processRefundEvent(client, refund, sideEffects, {
        allowRetryTransition: true,
      });
    },
    {
      name: `refund_reconcile:${source}`,
      maxAttempts: 4,
      lockTimeoutMs: 2500,
      statementTimeoutMs: 20000,
    }
  );

  await publishSideEffects(sideEffects, "refund_reconciled");

  const normalized = normalizeRefundStatusFromGateway(refund.refund_status);
  void recordOperationalEvent({
    category: "payment",
    severity: "info",
    eventName: "refund_gateway_reconciled",
    metadata: {
      orderId,
      refundId,
      source,
      gatewayStatus: refund.refund_status,
      normalizedStatus: normalized,
    },
  });

  return {
    orderId,
    refundId,
    gatewayStatus: refund.refund_status,
    normalizedStatus: normalized,
    resolved: normalized !== "refund_pending",
  };
}

async function claimPendingRefunds(limit) {
  const result = await pool.query(
    `
    SELECT id,
           reservation_id,
           order_id,
           refund_id,
           reliability_deposit_refund_id,
           status,
           refund_status,
           reliability_deposit_status,
           updated_at,
           last_reconciled_at
    FROM payments
    WHERE (
      refund_id IS NOT NULL
      AND status IN ('refund_pending','refund_failed')
      AND COALESCE(last_reconciled_at, updated_at, created_at) < NOW() - ($2::int * INTERVAL '1 minute')
    )
    OR (
      reliability_deposit_refund_id IS NOT NULL
      AND reliability_deposit_status IN ('refund_pending','refund_failed')
      AND COALESCE(last_reconciled_at, updated_at, created_at) < NOW() - ($2::int * INTERVAL '1 minute')
    )
    ORDER BY COALESCE(last_reconciled_at, updated_at, created_at) ASC
    LIMIT $1
    `,
    [limit, REFUND_RECONCILIATION_STALE_MINUTES]
  );

  return result.rows;
}

async function reconcilePendingRefunds(options = {}) {
  const limit = options.limit || REFUND_RECONCILIATION_LIMIT;
  await ensurePaymentHardeningSchema();

  const rows = await claimPendingRefunds(limit);
  const results = [];

  for (const row of rows) {
    for (const refundId of [
      row.refund_id,
      row.reliability_deposit_refund_id,
    ].filter(Boolean)) {
      try {
        results.push(
          await reconcileRefundAgainstGateway({
            orderId: row.order_id,
            refundId,
            source: options.source || "refund_sweep",
          })
        );
      } catch (err) {
        logger.error("Pending refund reconciliation failed", {
          err,
          orderId: row.order_id,
          refundId,
          paymentId: row.id,
        });
        await pool.query(
          `
          UPDATE payments
          SET reconciliation_status='refund_gateway_unknown',
              reconciliation_attempts=COALESCE(reconciliation_attempts, 0) + 1,
              last_reconciled_at=NOW(),
              updated_at=NOW()
          WHERE id=$1
          `,
          [row.id]
        );
      }
    }
  }

  return results;
}

async function reconcileStalePaymentSessions(options = {}) {
  const {
    reservationIds = null,
    limit = PAYMENT_RECONCILIATION_LIMIT,
  } = options;

  await ensurePaymentHardeningSchema();

  const client = await pool.connect();
  let rows = [];

  try {
    await client.query("BEGIN");

    if (Array.isArray(reservationIds) && reservationIds.length > 0) {
      const result = await client.query(
        `
        SELECT p.order_id
        FROM reservations r
        JOIN payments p ON p.reservation_id=r.id
        WHERE r.id = ANY($1::uuid[])
        AND r.status='payment_pending'
        AND r.payment_status='pending'
        AND p.status='pending'
        AND COALESCE(r.payment_expires_at, r.reserved_at + INTERVAL '10 minutes') <= NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM cashfree_webhook_events we
          WHERE we.order_id=p.order_id
          AND we.received_at > NOW() - INTERVAL '2 minutes'
          AND we.status IN ('processing', 'failed')
        )
        FOR UPDATE OF r SKIP LOCKED
        `,
        [reservationIds]
      );
      rows = result.rows;
    } else {
      const result = await client.query(
        `
        SELECT p.order_id
        FROM reservations r
        JOIN payments p ON p.reservation_id=r.id
        WHERE r.status='payment_pending'
        AND r.payment_status='pending'
        AND p.status='pending'
        AND COALESCE(r.payment_expires_at, r.reserved_at + INTERVAL '10 minutes') <= NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM cashfree_webhook_events we
          WHERE we.order_id=p.order_id
          AND we.received_at > NOW() - INTERVAL '2 minutes'
          AND we.status IN ('processing', 'failed')
        )
        ORDER BY p.order_id
        LIMIT $1
        FOR UPDATE OF r SKIP LOCKED
        `,
        [limit]
      );
      rows = result.rows;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const results = [];
  const orderIds = [...new Set(rows.map((row) => row.order_id).filter(Boolean))];
  for (const orderId of orderIds) {
    try {
      results.push(await reconcileOrder({ orderId, source: "stale_cleanup" }));
    } catch (err) {
      logger.error("Stale payment reconciliation item failed", {
        err,
        orderId,
      });
    }
  }

  return results;
}

module.exports = {
  ensurePaymentHardeningSchema,
  fetchCashfreeRefundState,
  handleCashfreeWebhook,
  markPaymentOrderAttemptDbInserted,
  markPaymentOrderAttemptFailed,
  markPaymentOrderAttemptGatewayCreated,
  markPaymentOrderAttemptCommitted,
  normalizeRefundStatusFromGateway,
  recordPaymentOrderAttempt,
  reconcileOrder,
  reconcilePendingRefunds,
  reconcileRefundAgainstGateway,
  reconcileStalePaymentSessions,
  recoverPaymentOrderAttempts,
  restorePendingReservation,
  shouldApplyRefundWebhook,
  verifyCashfreeWebhookSignature,
};
