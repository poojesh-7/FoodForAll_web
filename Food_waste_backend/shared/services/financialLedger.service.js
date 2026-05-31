const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");
const logger = require("../utils/logger");
const {
  incrementCounter,
} = require("./metrics.service");
const {
  recordAlert,
} = require("./observability.service");
const {
  getFinancialOwnership,
  roundMoney,
} = require("./financialOwnership.service");

const SETTLEMENT_VERSION = 1;
const DEFAULT_COMMISSION_PERCENT = 5;

let schemaReady;

function compactText(value, fallback = null, maxLength = 160) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function normalizeCurrency(value) {
  return compactText(value, "INR", 12).toUpperCase();
}

function getPlatformCommissionPercent() {
  const raw = process.env.PLATFORM_COMMISSION_PERCENT;
  const parsed = Number(raw);

  if (raw !== undefined && raw !== "" && Number.isFinite(parsed) && parsed >= 0) {
    return Math.round(parsed * 1000) / 1000;
  }

  return DEFAULT_COMMISSION_PERCENT;
}

function buildSettlementAllocationSnapshot({
  payment = {},
  paymentOwnership,
  commissionPercent = getPlatformCommissionPercent(),
  settlementVersion = SETTLEMENT_VERSION,
  metadata = {},
}) {
  if (!paymentOwnership?.reservation_id) {
    throw new Error("payment_ownership reservation_id is required");
  }
  if (!paymentOwnership?.payment_session_id) {
    throw new Error("payment_ownership payment_session_id is required");
  }
  if (!paymentOwnership?.id) {
    throw new Error("payment_ownership id is required");
  }

  const foodAmount = roundMoney(paymentOwnership.food_amount ?? payment.food_amount);
  const depositAmount = roundMoney(
    paymentOwnership.deposit_amount ?? payment.reliability_deposit_amount
  );
  const taxAmount = roundMoney(payment.tax_amount || 0);
  const commission = roundMoney(foodAmount * (Number(commissionPercent) / 100));
  const providerAmount = roundMoney(Math.max(foodAmount - commission, 0));
  const platformAmount = roundMoney(commission);
  const totalAmount = roundMoney(foodAmount + depositAmount + taxAmount);
  const currency = normalizeCurrency(paymentOwnership.currency || payment.currency);
  const reservationId = String(paymentOwnership.reservation_id);
  const paymentSessionId = String(paymentOwnership.payment_session_id);

  return {
    reservation_id: reservationId,
    payment_id: payment.id || null,
    payment_session_id: paymentSessionId,
    payment_ownership_id: paymentOwnership.id,
    commission_percent: Number(commissionPercent),
    commission_amount: commission,
    provider_amount: providerAmount,
    platform_amount: platformAmount,
    deposit_amount: depositAmount,
    tax_amount: taxAmount,
    food_amount: foodAmount,
    total_amount: totalAmount,
    currency,
    settlement_version: settlementVersion,
    idempotency_key: [
      "settlement_allocation",
      reservationId,
      paymentSessionId,
      `v${settlementVersion}`,
    ].join(":"),
    metadata: {
      source: "financial_integrity_f4",
      commission_source: "PLATFORM_COMMISSION_PERCENT",
      payment_id: payment.id || null,
      order_id: payment.order_id || null,
      ...metadata,
    },
  };
}

async function ensureSettlementAccountingSchema(client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) {
    schemaReady = schemaReady || Promise.resolve();
    return schemaReady;
  }

  const db = client || pool;
  if (db === pool && schemaReady) return schemaReady;

  const run = async () => {
    await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS settlement_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_reference TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'planned',
        currency TEXT NOT NULL DEFAULT 'INR',
        provider_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        commission_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS settlement_allocation_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
        payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
        payment_session_id TEXT NOT NULL,
        payment_ownership_id UUID NOT NULL REFERENCES payment_ownership(id) ON DELETE RESTRICT,
        commission_percent NUMERIC(6,3) NOT NULL DEFAULT 0,
        commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        provider_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        platform_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        food_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'INR',
        settlement_version INTEGER NOT NULL DEFAULT 1,
        idempotency_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS provider_settlements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
        payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
        payment_session_id TEXT NOT NULL,
        settlement_allocation_id UUID NOT NULL REFERENCES settlement_allocation_snapshots(id) ON DELETE RESTRICT,
        settlement_batch_id UUID NULL REFERENCES settlement_batches(id) ON DELETE RESTRICT,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'INR',
        status TEXT NOT NULL DEFAULT 'allocated',
        idempotency_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS financial_ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
        payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
        payment_session_id TEXT NOT NULL,
        payment_ownership_id UUID NULL REFERENCES payment_ownership(id) ON DELETE RESTRICT,
        settlement_allocation_id UUID NULL REFERENCES settlement_allocation_snapshots(id) ON DELETE RESTRICT,
        provider_settlement_id UUID NULL REFERENCES provider_settlements(id) ON DELETE RESTRICT,
        settlement_batch_id UUID NULL REFERENCES settlement_batches(id) ON DELETE RESTRICT,
        event_type TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'INR',
        actor_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
        actor_role TEXT NULL,
        counterparty_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
        counterparty_role TEXT NULL,
        refund_id TEXT NULL,
        source_type TEXT NOT NULL DEFAULT 'system',
        source_id TEXT NULL,
        idempotency_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS financial_refund_terminal_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
        payment_session_id TEXT NOT NULL,
        payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
        refund_type TEXT NOT NULL,
        refund_id TEXT NULL,
        terminal_status TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'INR',
        idempotency_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_allocation_idempotency_key
      ON settlement_allocation_snapshots (idempotency_key)
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_allocation_reservation_session_version
      ON settlement_allocation_snapshots (reservation_id, payment_session_id, settlement_version)
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_settlements_idempotency_key
      ON provider_settlements (idempotency_key)
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_ledger_entries_idempotency_key
      ON financial_ledger_entries (idempotency_key)
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_refund_terminal_idempotency_key
      ON financial_refund_terminal_records (idempotency_key)
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_refund_terminal_once
      ON financial_refund_terminal_records (reservation_id, refund_type)
      WHERE terminal_status IN ('refunded','retained')
    `);
  };

  if (db === pool) {
    schemaReady = run();
    return schemaReady;
  }

  return run();
}

async function insertAllocationSnapshot(client, snapshot) {
  const result = await client.query(
    `
    INSERT INTO settlement_allocation_snapshots (
      reservation_id, payment_id, payment_session_id, payment_ownership_id,
      commission_percent, commission_amount, provider_amount, platform_amount,
      deposit_amount, tax_amount, food_amount, total_amount, currency,
      settlement_version, idempotency_key, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      snapshot.reservation_id,
      snapshot.payment_id,
      snapshot.payment_session_id,
      snapshot.payment_ownership_id,
      snapshot.commission_percent,
      snapshot.commission_amount,
      snapshot.provider_amount,
      snapshot.platform_amount,
      snapshot.deposit_amount,
      snapshot.tax_amount,
      snapshot.food_amount,
      snapshot.total_amount,
      snapshot.currency,
      snapshot.settlement_version,
      snapshot.idempotency_key,
      JSON.stringify(snapshot.metadata || {}),
    ]
  );

  if (result.rows[0]) return { snapshot: result.rows[0], inserted: true };

  const existing = await client.query(
    `
    SELECT *
    FROM settlement_allocation_snapshots
    WHERE idempotency_key=$1
    LIMIT 1
    `,
    [snapshot.idempotency_key]
  );

  return { snapshot: existing.rows[0] || null, inserted: false };
}

async function recordLedgerEntry({ client = pool, entry }) {
  const result = await client.query(
    `
    INSERT INTO financial_ledger_entries (
      reservation_id, payment_id, payment_session_id, payment_ownership_id,
      settlement_allocation_id, provider_settlement_id, settlement_batch_id,
      event_type, amount, currency, actor_user_id, actor_role,
      counterparty_user_id, counterparty_role, refund_id, source_type, source_id,
      idempotency_key, metadata
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      entry.reservation_id,
      entry.payment_id || null,
      entry.payment_session_id,
      entry.payment_ownership_id || null,
      entry.settlement_allocation_id || null,
      entry.provider_settlement_id || null,
      entry.settlement_batch_id || null,
      entry.event_type,
      roundMoney(entry.amount),
      normalizeCurrency(entry.currency),
      entry.actor_user_id || null,
      entry.actor_role || null,
      entry.counterparty_user_id || null,
      entry.counterparty_role || null,
      entry.refund_id || null,
      compactText(entry.source_type, "system", 80),
      entry.source_id || null,
      entry.idempotency_key,
      JSON.stringify(entry.metadata || {}),
    ]
  );

  const inserted = Boolean(result.rows[0]);
  incrementCounter("food_rescue_financial_ledger_entries_total", {
    event_type: entry.event_type,
    status: inserted ? "created" : "duplicate",
  });

  return result.rows[0] || null;
}

function ledgerEntryForAllocation({ allocation, eventType, amount, suffix, metadata = {} }) {
  return {
    reservation_id: allocation.reservation_id,
    payment_id: allocation.payment_id,
    payment_session_id: allocation.payment_session_id,
    payment_ownership_id: allocation.payment_ownership_id,
    settlement_allocation_id: allocation.id,
    event_type: eventType,
    amount,
    currency: allocation.currency,
    source_type: "settlement_allocation",
    source_id: allocation.id,
    idempotency_key: [
      "ledger",
      eventType,
      allocation.reservation_id,
      allocation.payment_session_id,
      suffix,
    ].join(":"),
    metadata: {
      settlement_version: allocation.settlement_version,
      ...metadata,
    },
  };
}

async function insertProviderSettlement({ client, allocation, paymentOwnership }) {
  if (!paymentOwnership?.provider_id || roundMoney(allocation.provider_amount) <= 0) {
    return null;
  }

  const idempotencyKey = [
    "provider_settlement",
    allocation.reservation_id,
    allocation.payment_session_id,
    allocation.settlement_version,
  ].join(":");
  const result = await client.query(
    `
    INSERT INTO provider_settlements (
      provider_id, reservation_id, payment_id, payment_session_id,
      settlement_allocation_id, amount, commission_amount, currency,
      idempotency_key, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      paymentOwnership.provider_id,
      allocation.reservation_id,
      allocation.payment_id || null,
      allocation.payment_session_id,
      allocation.id,
      allocation.provider_amount,
      allocation.commission_amount,
      allocation.currency,
      idempotencyKey,
      JSON.stringify({ source: "settlement_allocation" }),
    ]
  );

  if (result.rows[0]) return result.rows[0];

  const existing = await client.query(
    `SELECT * FROM provider_settlements WHERE idempotency_key=$1 LIMIT 1`,
    [idempotencyKey]
  );

  return existing.rows[0] || null;
}

async function loadPaymentOwnershipForLedger({ client, payment, paymentOwnership }) {
  if (paymentOwnership) return paymentOwnership;

  const rows = await getFinancialOwnership({
    db: client,
    reservationId: payment?.reservation_id,
    paymentSessionId: payment?.payment_session_id,
  });

  return rows[0] || null;
}

async function recordSettlementAllocation({
  client = pool,
  payment,
  paymentOwnership,
  metadata = {},
} = {}) {
  if (!payment?.reservation_id || !payment?.payment_session_id) return null;

  const ownership = await loadPaymentOwnershipForLedger({
    client,
    payment,
    paymentOwnership,
  });

  if (!ownership) {
    await recordAlert({
      alertKey: `financial:f4:missing_ownership:${payment.id || payment.reservation_id}`,
      category: "payment",
      severity: "error",
      message: "F4 settlement allocation skipped because ownership snapshot is missing",
      metadata: {
        paymentId: payment.id,
        reservationId: payment.reservation_id,
        paymentSessionId: payment.payment_session_id,
      },
    });
    return null;
  }

  const draft = buildSettlementAllocationSnapshot({
    payment,
    paymentOwnership: ownership,
    metadata,
  });
  const { snapshot: allocation, inserted } = await insertAllocationSnapshot(
    client,
    draft
  );

  if (!allocation) return null;

  const providerSettlement = await insertProviderSettlement({
    client,
    allocation,
    paymentOwnership: ownership,
  });
  const base = { allocation, metadata: { allocation_inserted: inserted } };

  await recordLedgerEntry({
    client,
    entry: ledgerEntryForAllocation({
      ...base,
      eventType: "payment_collected",
      amount: allocation.total_amount,
      suffix: "total",
    }),
  });
  if (roundMoney(allocation.food_amount) > 0) {
    await recordLedgerEntry({
      client,
      entry: ledgerEntryForAllocation({
        ...base,
        eventType: "food_payment_settled",
        amount: allocation.food_amount,
        suffix: "food",
      }),
    });
  }
  if (roundMoney(allocation.commission_amount) > 0) {
    await recordLedgerEntry({
      client,
      entry: ledgerEntryForAllocation({
        ...base,
        eventType: "platform_commission",
        amount: allocation.commission_amount,
        suffix: "commission",
      }),
    });
  }
  if (roundMoney(allocation.deposit_amount) > 0) {
    await recordLedgerEntry({
      client,
      entry: ledgerEntryForAllocation({
        ...base,
        eventType: "deposit_collected",
        amount: allocation.deposit_amount,
        suffix: "deposit",
      }),
    });
  }
  if (providerSettlement) {
    await recordLedgerEntry({
      client,
      entry: {
        ...ledgerEntryForAllocation({
          ...base,
          eventType: "settlement_allocated",
          amount: providerSettlement.amount,
          suffix: "provider",
        }),
        provider_settlement_id: providerSettlement.id,
        counterparty_user_id: providerSettlement.provider_id,
        counterparty_role: "provider",
      },
    });
  }

  logger.payment("F4 settlement allocation recorded", {
    reservationId: allocation.reservation_id,
    paymentSessionId: allocation.payment_session_id,
    commissionPercent: allocation.commission_percent,
    commissionAmount: allocation.commission_amount,
    providerAmount: allocation.provider_amount,
  });

  return { allocation, providerSettlement, inserted };
}

function refundLedgerType(operation, status) {
  if (status === "retained") return "deposit_retained";
  if (status === "failed") return "refund_failed";
  if (status === "processing" && Number(operation.retry_count || 0) > 0) {
    return "refund_retried";
  }
  if (status !== "succeeded") return null;
  if (operation.operation_type === "deposit_refund") return "deposit_refunded";
  return "refund_issued";
}

function refundTypeForOperation(operation) {
  if (operation.operation_type === "deposit_refund") return "deposit";
  if (operation.operation_type === "deposit_retention") return "deposit";
  return "payment";
}

async function insertRefundTerminalRecord({ client, operation, eventType, refundId }) {
  const terminalStatus = eventType === "deposit_retained" ? "retained" : "refunded";
  const refundType = refundTypeForOperation(operation);
  const idempotencyKey = [
    "refund_terminal",
    refundType,
    operation.reservation_id,
    operation.payment_session_id,
    terminalStatus,
  ].join(":");

  await client.query(
    `
    INSERT INTO financial_refund_terminal_records (
      reservation_id, payment_session_id, refund_type, refund_id, terminal_status,
      amount, currency, idempotency_key, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT DO NOTHING
    `,
    [
      operation.reservation_id,
      operation.payment_session_id,
      refundType,
      refundId || null,
      terminalStatus,
      roundMoney(operation.amount),
      normalizeCurrency(operation.currency),
      idempotencyKey,
      JSON.stringify({
        operation_id: operation.id,
        operation_type: operation.operation_type,
      }),
    ]
  );
}

async function recordFinancialOperationLedgerStatus({
  client = pool,
  operation,
  status,
  refundId = null,
  metadata = {},
} = {}) {
  if (!operation?.reservation_id || !operation?.payment_session_id) return null;

  const eventType = refundLedgerType(operation, status);
  if (!eventType) return null;

  const sourceId = operation.id || operation.idempotency_key;
  const resolvedRefundId = refundId || operation.metadata?.refund_id || null;
  const entry = {
    reservation_id: operation.reservation_id,
    payment_session_id: operation.payment_session_id,
    payment_ownership_id: operation.payment_ownership_id || null,
    event_type: eventType,
    amount: roundMoney(operation.amount),
    currency: operation.currency,
    actor_user_id: operation.actor_user_id || null,
    actor_role: operation.actor_role || null,
    refund_id: resolvedRefundId,
    source_type: "financial_operation",
    source_id: sourceId,
    idempotency_key: [
      "ledger",
      eventType,
      operation.reservation_id,
      operation.payment_session_id,
      operation.operation_type,
      resolvedRefundId || "no_refund_id",
      status,
    ].join(":"),
    metadata: {
      operation_id: operation.id || null,
      operation_type: operation.operation_type,
      operation_source: operation.operation_source,
      status,
      ...metadata,
    },
  };

  const row = await recordLedgerEntry({ client, entry });

  if (eventType === "deposit_retained" || eventType === "deposit_refunded" || eventType === "refund_issued") {
    await insertRefundTerminalRecord({
      client,
      operation,
      eventType,
      refundId: resolvedRefundId,
    });
  }

  return row;
}

async function getFinancialDiagnostics({ client = pool } = {}) {
  await ensureSettlementAccountingSchema(client);

  const [ledger, refunds, settlements] = await Promise.all([
    client.query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE event_type='payment_collected'), 0)::numeric AS collected_total,
        COALESCE(SUM(amount) FILTER (WHERE event_type IN ('refund_issued','deposit_refunded')), 0)::numeric AS refunded_total,
        COALESCE(SUM(amount) FILTER (WHERE event_type='deposit_retained'), 0)::numeric AS retained_deposits,
        COALESCE(SUM(amount) FILTER (WHERE event_type='settlement_allocated'), 0)::numeric AS settlement_total,
        COALESCE(SUM(amount) FILTER (WHERE event_type='platform_commission'), 0)::numeric AS commission_total
      FROM financial_ledger_entries
    `),
    client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='processing')::int AS pending_refunds,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed_refunds
      FROM financial_operations
      WHERE operation_type IN ('payment_refund','deposit_refund')
    `),
    client.query(`
      SELECT
        COUNT(*)::int AS provider_settlements,
        COALESCE(SUM(amount), 0)::numeric AS provider_settlement_total,
        COALESCE(SUM(commission_amount), 0)::numeric AS provider_commission_total
      FROM provider_settlements
      WHERE status IN ('allocated','batched')
    `),
  ]);

  return {
    collectedTotals: Number(ledger.rows[0]?.collected_total || 0),
    refundedTotals: Number(ledger.rows[0]?.refunded_total || 0),
    retainedDeposits: Number(ledger.rows[0]?.retained_deposits || 0),
    pendingRefunds: Number(refunds.rows[0]?.pending_refunds || 0),
    failedRefunds: Number(refunds.rows[0]?.failed_refunds || 0),
    settlementTotals: Number(ledger.rows[0]?.settlement_total || 0),
    commissionTotals: Number(ledger.rows[0]?.commission_total || 0),
    providerSettlements: Number(settlements.rows[0]?.provider_settlements || 0),
    providerSettlementTotals: Number(
      settlements.rows[0]?.provider_settlement_total || 0
    ),
  };
}

module.exports = {
  SETTLEMENT_VERSION,
  buildSettlementAllocationSnapshot,
  ensureSettlementAccountingSchema,
  getFinancialDiagnostics,
  getPlatformCommissionPercent,
  recordFinancialOperationLedgerStatus,
  recordLedgerEntry,
  recordSettlementAllocation,
};
