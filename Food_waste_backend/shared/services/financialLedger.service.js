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
const ACCOUNTING_CATEGORIES = Object.freeze({
  PLATFORM_COMMISSION_REVENUE: "platform_commission_revenue",
  GATEWAY_FEE_EXPENSE: "gateway_fee_expense",
  RELIABILITY_DEPOSIT_HELD: "reliability_deposit_held",
  RELIABILITY_DEPOSIT_REFUNDED: "reliability_deposit_refunded",
  RELIABILITY_DEPOSIT_RETAINED: "reliability_deposit_retained",
  PROVIDER_SETTLEMENT_LIABILITY: "provider_settlement_liability",
  PROVIDER_SETTLEMENT_PAID: "provider_settlement_paid",
  REFUND_EXPENSE: "refund_expense",
});
const ACCOUNTING_CATEGORY_VALUES = Object.freeze(
  Object.values(ACCOUNTING_CATEGORIES)
);
const ACCOUNTING_CATEGORY_SET = new Set(ACCOUNTING_CATEGORY_VALUES);
const EVENT_ACCOUNTING_CATEGORIES = Object.freeze({
  platform_commission: ACCOUNTING_CATEGORIES.PLATFORM_COMMISSION_REVENUE,
  gateway_fee_recorded: ACCOUNTING_CATEGORIES.GATEWAY_FEE_EXPENSE,
  deposit_collected: ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_HELD,
  deposit_refunded: ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_REFUNDED,
  deposit_retained: ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_RETAINED,
  settlement_allocated: ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_LIABILITY,
  provider_settlement_paid: ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_PAID,
  refund_issued: ACCOUNTING_CATEGORIES.REFUND_EXPENSE,
});
const ACCOUNTING_CATEGORY_LABELS = Object.freeze({
  [ACCOUNTING_CATEGORIES.PLATFORM_COMMISSION_REVENUE]: "Commission Revenue",
  [ACCOUNTING_CATEGORIES.GATEWAY_FEE_EXPENSE]: "Gateway Fee Expense",
  [ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_HELD]: "Deposit Held",
  [ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_REFUNDED]: "Deposit Refunded",
  [ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_RETAINED]: "Deposit Retained",
  [ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_LIABILITY]: "Provider Liability",
  [ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_PAID]: "Provider Paid",
  [ACCOUNTING_CATEGORIES.REFUND_EXPENSE]: "Refund",
});
const PENDING_SETTLEMENT_STATUSES = ["pending", "processing", "allocated", "batched"];
const PAID_SETTLEMENT_STATUSES = ["paid", "settled"];

let schemaReady;

function compactText(value, fallback = null, maxLength = 160) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function normalizeCurrency(value) {
  return compactText(value, "INR", 12).toUpperCase();
}

function accountingCategoryForEventType(eventType) {
  return EVENT_ACCOUNTING_CATEGORIES[String(eventType || "")] || null;
}

function normalizeAccountingCategory(value, eventType = null) {
  const category =
    compactText(value, null, 80) || accountingCategoryForEventType(eventType);

  if (!category) return null;
  if (!ACCOUNTING_CATEGORY_SET.has(category)) {
    throw new Error(`Invalid accounting category: ${category}`);
  }

  return category;
}

function accountingCategoryLabel(category) {
  return (
    ACCOUNTING_CATEGORY_LABELS[category] ||
    String(category || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function getPlatformCommissionPercent() {
  const raw = process.env.PLATFORM_COMMISSION_PERCENT;
  const parsed = Number(raw);

  if (raw !== undefined && raw !== "" && Number.isFinite(parsed) && parsed >= 0) {
    return Math.round(parsed * 1000) / 1000;
  }

  return DEFAULT_COMMISSION_PERCENT;
}

function normalizeCommissionPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 1000) / 1000
    : getPlatformCommissionPercent();
}

function isPresent(value) {
  return value !== null && value !== undefined;
}

function buildPaymentFinancialTerms({
  foodAmount,
  foodAmountSnapshot,
  commissionPercent = getPlatformCommissionPercent(),
  commissionAmount,
  providerAmount,
  platformAmount,
} = {}) {
  const frozenFoodAmount = roundMoney(foodAmountSnapshot ?? foodAmount);
  const frozenCommissionPercent = normalizeCommissionPercent(commissionPercent);
  const computedCommission = roundMoney(
    frozenFoodAmount * (frozenCommissionPercent / 100)
  );
  const frozenCommissionAmount = isPresent(commissionAmount)
    ? roundMoney(commissionAmount)
    : computedCommission;
  const frozenProviderAmount = isPresent(providerAmount)
    ? roundMoney(providerAmount)
    : roundMoney(Math.max(frozenFoodAmount - frozenCommissionAmount, 0));
  const frozenPlatformAmount = isPresent(platformAmount)
    ? roundMoney(platformAmount)
    : frozenCommissionAmount;

  return {
    commission_percent: frozenCommissionPercent,
    commission_amount: frozenCommissionAmount,
    provider_amount: frozenProviderAmount,
    food_amount_snapshot: frozenFoodAmount,
    platform_amount: frozenPlatformAmount,
  };
}

function resolveSettlementFinancialTerms({ payment = {}, paymentOwnership }) {
  if (isPresent(payment.commission_percent)) {
    const missing = [
      "commission_amount",
      "provider_amount",
      "food_amount_snapshot",
      "platform_amount",
    ].filter((key) => !isPresent(payment[key]));

    if (missing.length) {
      throw new Error(
        `Payment financial snapshot is incomplete: ${missing.join(", ")}`
      );
    }

    return {
      ...buildPaymentFinancialTerms({
        foodAmountSnapshot: payment.food_amount_snapshot,
        commissionPercent: payment.commission_percent,
        commissionAmount: payment.commission_amount,
        providerAmount: payment.provider_amount,
        platformAmount: payment.platform_amount,
      }),
      terms_source: "payment_creation_snapshot",
    };
  }

  return {
    ...buildPaymentFinancialTerms({
      foodAmount: paymentOwnership?.food_amount ?? payment.food_amount,
      commissionPercent: getPlatformCommissionPercent(),
    }),
    terms_source: "legacy_env_fallback",
  };
}

function buildSettlementAllocationSnapshot({
  payment = {},
  paymentOwnership,
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

  const financialTerms = resolveSettlementFinancialTerms({
    payment,
    paymentOwnership,
  });
  const foodAmount = financialTerms.food_amount_snapshot;
  const depositAmount = roundMoney(
    paymentOwnership.deposit_amount ?? payment.reliability_deposit_amount
  );
  const taxAmount = roundMoney(payment.tax_amount || 0);
  const commission = financialTerms.commission_amount;
  const providerAmount = financialTerms.provider_amount;
  const platformAmount = financialTerms.platform_amount;
  const totalAmount = roundMoney(foodAmount + depositAmount + taxAmount);
  const currency = normalizeCurrency(paymentOwnership.currency || payment.currency);
  const reservationId = String(paymentOwnership.reservation_id);
  const paymentSessionId = String(paymentOwnership.payment_session_id);

  return {
    reservation_id: reservationId,
    payment_id: payment.id || null,
    payment_session_id: paymentSessionId,
    payment_ownership_id: paymentOwnership.id,
    commission_percent: financialTerms.commission_percent,
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
      commission_source: financialTerms.terms_source,
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
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMP NULL,
        payment_reference TEXT NULL,
        notes TEXT NULL,
        processed_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT provider_settlements_status_valid
          CHECK (status IN ('pending','processing','paid','failed','cancelled'))
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
        accounting_category TEXT NULL,
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
      CREATE TABLE IF NOT EXISTS financial_accounting_classifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        financial_ledger_entry_id UUID NOT NULL REFERENCES financial_ledger_entries(id) ON DELETE RESTRICT,
        reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
        payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
        payment_session_id TEXT NOT NULL,
        provider_settlement_id UUID NULL REFERENCES provider_settlements(id) ON DELETE RESTRICT,
        accounting_category TEXT NOT NULL,
        source_event_type TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'INR',
        refund_id TEXT NULL,
        source_type TEXT NOT NULL DEFAULT 'financial_ledger_entry',
        source_id TEXT NULL,
        idempotency_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      ALTER TABLE financial_ledger_entries
      ADD COLUMN IF NOT EXISTS accounting_category TEXT NULL
    `);
    await db.query(`
      ALTER TABLE financial_ledger_entries
      DROP CONSTRAINT IF EXISTS financial_ledger_entries_accounting_category_valid,
      ADD CONSTRAINT financial_ledger_entries_accounting_category_valid
        CHECK (
          accounting_category IS NULL
          OR accounting_category IN (
            'platform_commission_revenue',
            'gateway_fee_expense',
            'reliability_deposit_held',
            'reliability_deposit_refunded',
            'reliability_deposit_retained',
            'provider_settlement_liability',
            'provider_settlement_paid',
            'refund_expense'
          )
        )
    `);
    await db.query(`
      ALTER TABLE financial_ledger_entries
      DROP CONSTRAINT IF EXISTS financial_ledger_entries_event_type_valid,
      ADD CONSTRAINT financial_ledger_entries_event_type_valid
        CHECK (event_type IN (
          'payment_collected',
          'food_payment_settled',
          'platform_commission',
          'deposit_collected',
          'deposit_refunded',
          'deposit_retained',
          'refund_issued',
          'refund_failed',
          'refund_retried',
          'settlement_allocated',
          'provider_settlement_paid',
          'gateway_fee_recorded'
        ))
    `);
    await db.query(`
      ALTER TABLE financial_accounting_classifications
      DROP CONSTRAINT IF EXISTS financial_accounting_classifications_category_valid,
      ADD CONSTRAINT financial_accounting_classifications_category_valid
        CHECK (accounting_category IN (
          'platform_commission_revenue',
          'gateway_fee_expense',
          'reliability_deposit_held',
          'reliability_deposit_refunded',
          'reliability_deposit_retained',
          'provider_settlement_liability',
          'provider_settlement_paid',
          'refund_expense'
        ))
    `);
    await db.query(`
      ALTER TABLE financial_accounting_classifications
      DROP CONSTRAINT IF EXISTS financial_accounting_classifications_amount_nonnegative,
      ADD CONSTRAINT financial_accounting_classifications_amount_nonnegative
        CHECK (amount >= 0)
    `);
    await db.query(`
      ALTER TABLE financial_accounting_classifications
      DROP CONSTRAINT IF EXISTS financial_accounting_classifications_currency_present,
      ADD CONSTRAINT financial_accounting_classifications_currency_present
        CHECK (length(trim(currency)) > 0)
    `);
    await db.query(`
      ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS gateway_provider TEXT NULL,
      ADD COLUMN IF NOT EXISTS gateway_order_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS gateway_fee_amount NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS gateway_tax_amount NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS gateway_fee_recorded_at TIMESTAMP NULL
    `);
    await db.query(`
      ALTER TABLE payments
      DROP CONSTRAINT IF EXISTS payments_gateway_fee_amounts_nonnegative,
      ADD CONSTRAINT payments_gateway_fee_amounts_nonnegative
        CHECK (
          (gateway_fee_amount IS NULL OR gateway_fee_amount >= 0)
          AND (gateway_tax_amount IS NULL OR gateway_tax_amount >= 0)
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
      CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_accounting_category
      ON financial_ledger_entries (accounting_category, created_at DESC)
      WHERE accounting_category IS NOT NULL
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounting_classifications_idempotency
      ON financial_accounting_classifications (idempotency_key)
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounting_classifications_ledger_category
      ON financial_accounting_classifications (financial_ledger_entry_id, accounting_category)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_accounting_classifications_category
      ON financial_accounting_classifications (accounting_category, created_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_accounting_classifications_reservation
      ON financial_accounting_classifications (reservation_id, payment_session_id, created_at DESC)
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
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_gateway_fee_recorded
      ON payments (gateway_provider, gateway_fee_recorded_at DESC, id)
      WHERE gateway_fee_recorded_at IS NOT NULL
         OR gateway_fee_amount IS NOT NULL
         OR gateway_tax_amount IS NOT NULL
    `);
    await db.query(`
      CREATE OR REPLACE FUNCTION prevent_financial_ledger_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'financial ledger and settlement snapshot rows are immutable';
      END;
      $$;
    `);
    await db.query(`
      DROP TRIGGER IF EXISTS trg_settlement_allocation_immutable ON settlement_allocation_snapshots;
      CREATE TRIGGER trg_settlement_allocation_immutable
        BEFORE UPDATE OR DELETE ON settlement_allocation_snapshots
        FOR EACH ROW
        EXECUTE FUNCTION prevent_financial_ledger_mutation();
    `);
    await db.query(`
      DROP TRIGGER IF EXISTS trg_financial_ledger_entries_immutable ON financial_ledger_entries;
      CREATE TRIGGER trg_financial_ledger_entries_immutable
        BEFORE UPDATE OR DELETE ON financial_ledger_entries
        FOR EACH ROW
        EXECUTE FUNCTION prevent_financial_ledger_mutation();
    `);
    await db.query(`
      DROP TRIGGER IF EXISTS trg_financial_refund_terminal_immutable ON financial_refund_terminal_records;
      CREATE TRIGGER trg_financial_refund_terminal_immutable
        BEFORE UPDATE OR DELETE ON financial_refund_terminal_records
        FOR EACH ROW
        EXECUTE FUNCTION prevent_financial_ledger_mutation();
    `);
    await db.query(`
      DROP TRIGGER IF EXISTS trg_financial_accounting_classifications_immutable ON financial_accounting_classifications;
      CREATE TRIGGER trg_financial_accounting_classifications_immutable
        BEFORE UPDATE OR DELETE ON financial_accounting_classifications
        FOR EACH ROW
        EXECUTE FUNCTION prevent_financial_ledger_mutation();
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

async function recordAccountingClassification({
  client = pool,
  ledgerEntry,
  accountingCategory,
  metadata = {},
} = {}) {
  const category = normalizeAccountingCategory(
    accountingCategory,
    ledgerEntry?.event_type
  );
  if (!ledgerEntry?.id || !category) return null;

  const idempotencyKey = [
    "accounting_classification",
    ledgerEntry.id,
    category,
  ].join(":");
  const result = await client.query(
    `
    INSERT INTO financial_accounting_classifications (
      financial_ledger_entry_id, reservation_id, payment_id, payment_session_id,
      provider_settlement_id, accounting_category, source_event_type, amount,
      currency, refund_id, source_type, source_id, idempotency_key, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      ledgerEntry.id,
      ledgerEntry.reservation_id,
      ledgerEntry.payment_id || null,
      ledgerEntry.payment_session_id,
      ledgerEntry.provider_settlement_id || null,
      category,
      ledgerEntry.event_type,
      roundMoney(ledgerEntry.amount),
      normalizeCurrency(ledgerEntry.currency),
      ledgerEntry.refund_id || null,
      compactText(ledgerEntry.source_type, "financial_ledger_entry", 80),
      ledgerEntry.source_id || ledgerEntry.id,
      idempotencyKey,
      JSON.stringify({
        ledger_idempotency_key: ledgerEntry.idempotency_key || null,
        ledger_accounting_category: ledgerEntry.accounting_category || null,
        ...metadata,
      }),
    ]
  );

  const inserted = Boolean(result.rows[0]);
  incrementCounter("food_rescue_financial_accounting_classifications_total", {
    accounting_category: category,
    status: inserted ? "created" : "duplicate",
  });

  return result.rows[0] || null;
}

async function findLedgerEntryByIdempotencyKey(client, idempotencyKey) {
  if (!idempotencyKey) return null;

  const existing = await client.query(
    `
    SELECT *
    FROM financial_ledger_entries
    WHERE idempotency_key=$1
    LIMIT 1
    `,
    [idempotencyKey]
  );

  return existing.rows[0] || null;
}

async function recordLedgerEntry({ client = pool, entry }) {
  const accountingCategory = normalizeAccountingCategory(
    entry.accounting_category,
    entry.event_type
  );
  const result = await client.query(
    `
    INSERT INTO financial_ledger_entries (
      reservation_id, payment_id, payment_session_id, payment_ownership_id,
      settlement_allocation_id, provider_settlement_id, settlement_batch_id,
      event_type, amount, currency, actor_user_id, actor_role,
      counterparty_user_id, counterparty_role, refund_id, source_type, source_id,
      accounting_category, idempotency_key, metadata
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
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
      accountingCategory,
      entry.idempotency_key,
      JSON.stringify(entry.metadata || {}),
    ]
  );

  const inserted = Boolean(result.rows[0]);
  let row = result.rows[0] || null;
  incrementCounter("food_rescue_financial_ledger_entries_total", {
    event_type: entry.event_type,
    status: inserted ? "created" : "duplicate",
  });

  if (!row && accountingCategory) {
    row = await findLedgerEntryByIdempotencyKey(client, entry.idempotency_key);
  }

  if (row && accountingCategory) {
    await recordAccountingClassification({
      client,
      ledgerEntry: {
        ...row,
        accounting_category: row.accounting_category || accountingCategory,
      },
      accountingCategory,
      metadata: {
        classification_source: inserted ? "ledger_insert" : "ledger_replay",
        ...(entry.accounting_metadata || {}),
      },
    });
  }

  return row;
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

async function recordProviderSettlementPaidLedger({
  client = pool,
  settlement,
  metadata = {},
} = {}) {
  if (!settlement?.id || roundMoney(settlement.amount) <= 0) return null;

  return recordLedgerEntry({
    client,
    entry: {
      reservation_id: settlement.reservation_id,
      payment_id: settlement.payment_id || null,
      payment_session_id: settlement.payment_session_id,
      settlement_allocation_id: settlement.settlement_allocation_id || null,
      provider_settlement_id: settlement.id,
      event_type: "provider_settlement_paid",
      amount: settlement.amount,
      currency: settlement.currency || "INR",
      counterparty_user_id: settlement.provider_id || null,
      counterparty_role: "provider",
      source_type: "provider_settlement",
      source_id: settlement.id,
      idempotency_key: ["ledger", "provider_settlement_paid", settlement.id].join(":"),
      metadata: {
        status: settlement.status,
        paid_at: settlement.paid_at || null,
        payment_reference: settlement.payment_reference || null,
        processed_by: settlement.processed_by || null,
        money_movement_executed_by_system: false,
        ...metadata,
      },
    },
  });
}

async function recordGatewayFeeExpense({
  client = pool,
  payment,
  gatewayFeeAmount,
  gatewayTaxAmount = 0,
  metadata = {},
} = {}) {
  const feeAmount = roundMoney(gatewayFeeAmount);
  if (!payment?.reservation_id || !payment?.payment_session_id || feeAmount <= 0) {
    return null;
  }

  return recordLedgerEntry({
    client,
    entry: {
      reservation_id: payment.reservation_id,
      payment_id: payment.id || null,
      payment_session_id: payment.payment_session_id,
      event_type: "gateway_fee_recorded",
      amount: feeAmount,
      currency: payment.currency || "INR",
      source_type: "payment_gateway",
      source_id: payment.gateway_order_id || payment.order_id || payment.id,
      idempotency_key: [
        "ledger",
        "gateway_fee_recorded",
        payment.id || payment.order_id,
        formatMoneyKey(feeAmount),
        formatMoneyKey(gatewayTaxAmount),
      ].join(":"),
      metadata: {
        gateway_provider: payment.gateway_provider || "cashfree",
        gateway_order_id: payment.gateway_order_id || payment.order_id || null,
        gateway_tax_amount: roundMoney(gatewayTaxAmount),
        ...metadata,
      },
    },
  });
}

function formatMoneyKey(value) {
  return roundMoney(value).toFixed(2);
}

async function repairMissingAccountingClassificationsForPayment({
  client = pool,
  payment,
} = {}) {
  const reservationId = payment?.reservation_id;
  const paymentSessionId = payment?.payment_session_id;
  if (!reservationId || !paymentSessionId) return [];

  const result = await client.query(
    `
    SELECT *
    FROM financial_ledger_entries
    WHERE reservation_id=$1
    AND payment_session_id=$2
    AND event_type = ANY($3::text[])
    ORDER BY created_at ASC, id ASC
    `,
    [
      reservationId,
      paymentSessionId,
      Object.keys(EVENT_ACCOUNTING_CATEGORIES),
    ]
  );
  const repaired = [];

  for (const ledgerEntry of result.rows) {
    const category = normalizeAccountingCategory(
      ledgerEntry.accounting_category,
      ledgerEntry.event_type
    );
    if (!category) continue;

    const classification = await recordAccountingClassification({
      client,
      ledgerEntry,
      accountingCategory: category,
      metadata: {
        classification_source: "financial_reconciliation_worker",
        repair_payment_id: payment.id || null,
      },
    });
    if (classification) repaired.push(classification);
  }

  return repaired;
}

function accountingCategoryCaseSql(alias = "fle") {
  const cases = Object.entries(EVENT_ACCOUNTING_CATEGORIES)
    .map(([eventType, category]) => `WHEN '${eventType}' THEN '${category}'`)
    .join("\n          ");

  return `CASE ${alias}.event_type
          ${cases}
          ELSE NULL
        END`;
}

function normalizeSummaryLimit(value, fallback = 25) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 100)
    : fallback;
}

function categoryTotalMap(rows = []) {
  const totals = new Map(
    ACCOUNTING_CATEGORY_VALUES.map((category) => [
      category,
      {
        accounting_category: category,
        label: accountingCategoryLabel(category),
        total: 0,
        count: 0,
        currency: "INR",
        last_recorded_at: null,
      },
    ])
  );

  for (const row of rows) {
    const category = row.accounting_category;
    if (!ACCOUNTING_CATEGORY_SET.has(category)) continue;

    totals.set(category, {
      accounting_category: category,
      label: accountingCategoryLabel(category),
      total: Number(row.total || 0),
      count: Number(row.count || 0),
      currency: row.currency || "INR",
      last_recorded_at: row.last_recorded_at || null,
    });
  }

  return totals;
}

function amountForCategory(totals, category) {
  return Number(totals.get(category)?.total || 0);
}

async function getFinancialSummary({ client = pool, limit = 25 } = {}) {
  await ensureSettlementAccountingSchema(client);

  const categoryCase = accountingCategoryCaseSql("fle");
  const normalizedLimit = normalizeSummaryLimit(limit);
  const [categories, settlements, gatewayFees, recent] = await Promise.all([
    client.query(`
      WITH categorized AS (
        SELECT
          fac.accounting_category,
          fac.amount,
          fac.currency,
          fac.created_at
        FROM financial_accounting_classifications fac
        UNION ALL
        SELECT
          COALESCE(fle.accounting_category, ${categoryCase}) AS accounting_category,
          fle.amount,
          fle.currency,
          fle.created_at
        FROM financial_ledger_entries fle
        WHERE COALESCE(fle.accounting_category, ${categoryCase}) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM financial_accounting_classifications fac
          WHERE fac.financial_ledger_entry_id=fle.id
        )
      )
      SELECT
        accounting_category,
        COALESCE(SUM(amount), 0)::numeric AS total,
        COUNT(*)::int AS count,
        COALESCE(MAX(currency), 'INR') AS currency,
        MAX(created_at) AS last_recorded_at
      FROM categorized
      GROUP BY accounting_category
      ORDER BY accounting_category
    `),
    client.query(
      `
      SELECT
        COALESCE(SUM(amount) FILTER (
          WHERE status = ANY($1::text[])
        ), 0)::numeric AS pending,
        COALESCE(SUM(amount) FILTER (
          WHERE status = ANY($2::text[])
        ), 0)::numeric AS paid,
        COUNT(*) FILTER (
          WHERE status = ANY($1::text[])
        )::int AS pending_count,
        COUNT(*) FILTER (
          WHERE status = ANY($2::text[])
        )::int AS paid_count
      FROM provider_settlements
      `,
      [PENDING_SETTLEMENT_STATUSES, PAID_SETTLEMENT_STATUSES]
    ),
    client.query(`
      SELECT
        COALESCE(SUM(gateway_fee_amount), 0)::numeric AS gateway_fee_amount,
        COALESCE(SUM(gateway_tax_amount), 0)::numeric AS gateway_tax_amount,
        COUNT(*) FILTER (
          WHERE gateway_fee_recorded_at IS NOT NULL
             OR gateway_fee_amount IS NOT NULL
             OR gateway_tax_amount IS NOT NULL
        )::int AS recorded_count,
        MAX(gateway_fee_recorded_at) AS last_recorded_at
      FROM payments
    `),
    client.query(
      `
      SELECT
        fle.id,
        fle.reservation_id,
        fle.payment_id,
        fle.payment_session_id,
        fle.provider_settlement_id,
        fle.event_type,
        COALESCE(fac.accounting_category, fle.accounting_category, ${categoryCase}) AS accounting_category,
        fle.amount,
        fle.currency,
        fle.refund_id,
        fle.source_type,
        fle.source_id,
        fle.created_at
      FROM financial_ledger_entries fle
      LEFT JOIN LATERAL (
        SELECT accounting_category
        FROM financial_accounting_classifications fac
        WHERE fac.financial_ledger_entry_id=fle.id
        ORDER BY fac.created_at DESC, fac.id DESC
        LIMIT 1
      ) fac ON true
      WHERE COALESCE(fac.accounting_category, fle.accounting_category, ${categoryCase}) IS NOT NULL
      ORDER BY fle.created_at DESC, fle.id DESC
      LIMIT $1
      `,
      [normalizedLimit]
    ),
  ]);

  const totals = categoryTotalMap(categories.rows);
  const settlementRow = settlements.rows[0] || {};
  const gatewayRow = gatewayFees.rows[0] || {};
  const commissionRevenue = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.PLATFORM_COMMISSION_REVENUE
  );
  const depositsHeld = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_HELD
  );
  const depositsRefunded = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_REFUNDED
  );
  const depositsRetained = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_RETAINED
  );
  const providerLiabilityRecognized = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_LIABILITY
  );
  const providerPaidClassified = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_PAID
  );
  const refundExpense = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.REFUND_EXPENSE
  );
  const gatewayFeeExpense = amountForCategory(
    totals,
    ACCOUNTING_CATEGORIES.GATEWAY_FEE_EXPENSE
  );

  return {
    generated_at: new Date().toISOString(),
    currency: "INR",
    informational_only: true,
    mutation_api: false,
    totals: {
      total_commission_revenue: commissionRevenue,
      total_deposits_held: depositsHeld,
      total_deposits_refunded: depositsRefunded,
      total_deposits_retained: depositsRetained,
      total_provider_liabilities: Number(settlementRow.pending || 0),
      total_provider_paid: Number(settlementRow.paid || 0),
      total_refund_volume: refundExpense,
      total_gateway_fee_expense: gatewayFeeExpense,
    },
    revenue: {
      commission_revenue: commissionRevenue,
    },
    deposits: {
      held: depositsHeld,
      refunded: depositsRefunded,
      retained: depositsRetained,
      separated_from_commission_revenue: true,
      separated_from_provider_settlements: true,
    },
    provider_settlements: {
      pending: Number(settlementRow.pending || 0),
      paid: Number(settlementRow.paid || 0),
      pending_count: Number(settlementRow.pending_count || 0),
      paid_count: Number(settlementRow.paid_count || 0),
      liability_recognized: providerLiabilityRecognized,
      paid_classified: providerPaidClassified,
      excludes_deposits: true,
    },
    refunds: {
      total_refund_amount: refundExpense,
    },
    gateway_fees: {
      classified_expense: gatewayFeeExpense,
      gateway_fee_amount: Number(gatewayRow.gateway_fee_amount || 0),
      gateway_tax_amount: Number(gatewayRow.gateway_tax_amount || 0),
      recorded_count: Number(gatewayRow.recorded_count || 0),
      last_recorded_at: gatewayRow.last_recorded_at || null,
      gst_calculated: false,
    },
    classification_totals: Array.from(totals.values()),
    recent_entries: recent.rows.map((row) => ({
      id: row.id,
      reservation_id: row.reservation_id,
      payment_id: row.payment_id || null,
      payment_session_id: row.payment_session_id,
      provider_settlement_id: row.provider_settlement_id || null,
      event_type: row.event_type,
      accounting_category: row.accounting_category,
      accounting_category_label: accountingCategoryLabel(row.accounting_category),
      amount: Number(row.amount || 0),
      currency: row.currency || "INR",
      refund_id: row.refund_id || null,
      source_type: row.source_type || null,
      source_id: row.source_id || null,
      created_at: row.created_at || null,
    })),
  };
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
      WHERE status IN ('pending','processing','allocated','batched')
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
  ACCOUNTING_CATEGORIES,
  ACCOUNTING_CATEGORY_VALUES,
  SETTLEMENT_VERSION,
  accountingCategoryForEventType,
  accountingCategoryLabel,
  buildPaymentFinancialTerms,
  buildSettlementAllocationSnapshot,
  ensureSettlementAccountingSchema,
  getFinancialDiagnostics,
  getFinancialSummary,
  getPlatformCommissionPercent,
  normalizeAccountingCategory,
  recordAccountingClassification,
  recordFinancialOperationLedgerStatus,
  recordGatewayFeeExpense,
  recordLedgerEntry,
  recordProviderSettlementPaidLedger,
  recordSettlementAllocation,
  repairMissingAccountingClassificationsForPayment,
};
