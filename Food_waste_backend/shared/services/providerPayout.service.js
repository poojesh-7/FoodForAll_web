const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");
const { withTransaction } = require("../utils/transaction");
const {
  ensureSettlementAccountingSchema,
} = require("./financialLedger.service");

const ACCOUNT_TYPES = new Set(["UPI", "BANK"]);
const PENDING_SETTLEMENT_STATUSES = ["pending", "processing", "allocated", "batched"];
const PAID_SETTLEMENT_STATUSES = ["paid", "settled"];
const FAILED_SETTLEMENT_STATUSES = ["failed", "cancelled"];
const FINAL_SETTLEMENT_STATUSES = ["pending", "processing", "paid", "failed", "cancelled"];
const DEFAULT_ADMIN_SETTLEMENT_LIMIT = 100;

let schemaReady;

function serviceError(message, statusCode = 400, code = "VALIDATION_ERROR") {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function trimText(value, maxLength = 160) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : "";
}

function normalizeAccountType(value) {
  return trimText(value, 12).toUpperCase();
}

function normalizeLimit(value, fallback = DEFAULT_ADMIN_SETTLEMENT_LIMIT) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 500)
    : fallback;
}

function validatePayoutAccountInput(input = {}) {
  const accountType = normalizeAccountType(input.account_type || input.accountType);
  if (!ACCOUNT_TYPES.has(accountType)) {
    throw serviceError("Payout account type must be UPI or BANK.");
  }

  if (accountType === "UPI") {
    const upiId = trimText(input.upi_id || input.upiId, 120).toLowerCase();
    if (!/^[a-z0-9._-]{2,}@[a-z0-9._-]{2,}$/i.test(upiId)) {
      throw serviceError("UPI id must use a basic name@provider format.");
    }

    return {
      account_type: "UPI",
      upi_id: upiId,
      account_holder_name: null,
      bank_account_number: null,
      ifsc_code: null,
    };
  }

  const accountHolderName = trimText(
    input.account_holder_name || input.accountHolderName,
    160
  );
  const bankAccountNumber = trimText(
    input.bank_account_number || input.bankAccountNumber,
    40
  ).replace(/\s+/g, "");
  const ifscCode = trimText(input.ifsc_code || input.ifscCode, 20).toUpperCase();

  if (accountHolderName.length < 2) {
    throw serviceError("Account holder name is required.");
  }
  if (!/^[0-9]{6,20}$/.test(bankAccountNumber)) {
    throw serviceError("Bank account number must be 6 to 20 digits.");
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
    throw serviceError("IFSC code must use the standard 11 character format.");
  }

  return {
    account_type: "BANK",
    upi_id: null,
    account_holder_name: accountHolderName,
    bank_account_number: bankAccountNumber,
    ifsc_code: ifscCode,
  };
}

async function ensureProviderPayoutSchema(client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) {
    schemaReady = schemaReady || Promise.resolve();
    return schemaReady;
  }

  const db = client || pool;
  if (db === pool && schemaReady) return schemaReady;

  const run = async () => {
    await ensureSettlementAccountingSchema(db);
    await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS provider_payout_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        account_type TEXT NOT NULL,
        upi_id TEXT NULL,
        account_holder_name TEXT NULL,
        bank_account_number TEXT NULL,
        ifsc_code TEXT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        is_verified BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT provider_payout_accounts_type_valid
          CHECK (account_type IN ('UPI','BANK')),
        CONSTRAINT provider_payout_accounts_upi_shape
          CHECK (
            account_type <> 'UPI'
            OR (
              upi_id IS NOT NULL
              AND upi_id ~* '^[A-Z0-9._-]{2,}@[A-Z0-9._-]{2,}$'
            )
          ),
        CONSTRAINT provider_payout_accounts_bank_shape
          CHECK (
            account_type <> 'BANK'
            OR (
              account_holder_name IS NOT NULL
              AND length(trim(account_holder_name)) >= 2
              AND bank_account_number IS NOT NULL
              AND bank_account_number ~ '^[0-9]{6,20}$'
              AND ifsc_code IS NOT NULL
              AND ifsc_code ~* '^[A-Z]{4}0[A-Z0-9]{6}$'
            )
          )
      )
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_payout_accounts_one_active
      ON provider_payout_accounts (provider_id)
      WHERE is_active=true
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_payout_accounts_provider_created
      ON provider_payout_accounts (provider_id, created_at DESC)
    `);
    await db.query(`
      ALTER TABLE provider_settlements
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS payment_reference TEXT NULL,
      ADD COLUMN IF NOT EXISTS notes TEXT NULL,
      ADD COLUMN IF NOT EXISTS processed_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT
    `);
    await db.query(`
      ALTER TABLE provider_settlements
      DROP CONSTRAINT IF EXISTS provider_settlements_status_valid,
      ADD CONSTRAINT provider_settlements_status_valid
        CHECK (status IN ('allocated','batched','settled','pending','processing','paid','failed','cancelled'))
    `);
    await db.query(`
      UPDATE provider_settlements
      SET status = CASE
        WHEN status IN ('allocated','batched') THEN 'pending'
        WHEN status='settled' THEN 'paid'
        ELSE status
      END
      WHERE status IN ('allocated','batched','settled')
    `);
    await db.query(`
      ALTER TABLE provider_settlements
      ALTER COLUMN status SET DEFAULT 'pending',
      DROP CONSTRAINT IF EXISTS provider_settlements_status_valid,
      ADD CONSTRAINT provider_settlements_status_valid
        CHECK (status IN ('pending','processing','paid','failed','cancelled'))
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_settlements_status_created_tfin2
      ON provider_settlements (status, created_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_settlements_provider_status_tfin2
      ON provider_settlements (provider_id, status, created_at DESC)
    `);
  };

  if (db === pool) {
    schemaReady = run();
    return schemaReady;
  }

  return run();
}

function serializePayoutAccount(row) {
  if (!row) return null;
  const bankAccountNumber = row.bank_account_number
    ? String(row.bank_account_number)
    : null;
  return {
    id: row.id,
    provider_id: row.provider_id,
    account_type: row.account_type,
    upi_id: row.upi_id || null,
    account_holder_name: row.account_holder_name || null,
    bank_account_number: bankAccountNumber,
    bank_account_number_last4: bankAccountNumber
      ? bankAccountNumber.slice(-4)
      : null,
    ifsc_code: row.ifsc_code || null,
    is_active: Boolean(row.is_active),
    is_verified: Boolean(row.is_verified),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function listProviderPayoutAccounts({
  client = pool,
  providerId,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureProviderPayoutSchema(client);
  }

  const result = await client.query(
    `
    SELECT *
    FROM provider_payout_accounts
    WHERE provider_id=$1
    ORDER BY is_active DESC, created_at DESC, id DESC
    `,
    [providerId]
  );
  const accounts = result.rows.map(serializePayoutAccount);

  return {
    active_account: accounts.find((account) => account.is_active) || null,
    accounts,
  };
}

async function replaceProviderPayoutAccount({
  client,
  providerId,
  payload,
  ensureSchema = true,
} = {}) {
  const sanitized = validatePayoutAccountInput(payload);
  const replacePayoutAccount = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    await db.query(
      `
      UPDATE provider_payout_accounts
      SET is_active=false, updated_at=NOW()
      WHERE provider_id=$1 AND is_active=true
      `,
      [providerId]
    );

    const inserted = await db.query(
      `
      INSERT INTO provider_payout_accounts (
        provider_id, account_type, upi_id, account_holder_name,
        bank_account_number, ifsc_code, is_active, is_verified
      )
      VALUES ($1,$2,$3,$4,$5,$6,true,false)
      RETURNING *
      `,
      [
        providerId,
        sanitized.account_type,
        sanitized.upi_id,
        sanitized.account_holder_name,
        sanitized.bank_account_number,
        sanitized.ifsc_code,
      ]
    );

    return serializePayoutAccount(inserted.rows[0]);
  };

  if (client) return replacePayoutAccount(client);

  return withTransaction(pool, replacePayoutAccount, {
    name: "replace_provider_payout_account",
    maxAttempts: 3,
  });
}

async function deactivateProviderPayoutAccount({
  client,
  providerId,
  ensureSchema = true,
} = {}) {
  const deactivateActivePayoutAccount = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const result = await db.query(
      `
      UPDATE provider_payout_accounts
      SET is_active=false, updated_at=NOW()
      WHERE provider_id=$1 AND is_active=true
      RETURNING *
      `,
      [providerId]
    );

    return serializePayoutAccount(result.rows[0] || null);
  };

  if (client) return deactivateActivePayoutAccount(client);

  return withTransaction(pool, deactivateActivePayoutAccount, {
    name: "deactivate_provider_payout_account",
    maxAttempts: 3,
  });
}

function normalizeSettlementStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "allocated" || value === "batched") return "pending";
  if (value === "settled") return "paid";
  return value || "pending";
}

function serializeSettlement(row) {
  return {
    id: row.id,
    provider_id: row.provider_id,
    reservation_id: row.reservation_id,
    payment_id: row.payment_id || null,
    payment_session_id: row.payment_session_id,
    settlement_allocation_id: row.settlement_allocation_id || null,
    amount: Number(row.amount || 0),
    commission_amount: Number(row.commission_amount || 0),
    currency: row.currency || "INR",
    status: normalizeSettlementStatus(row.status),
    raw_status: row.status,
    paid_at: row.paid_at || null,
    payment_reference: row.payment_reference || null,
    notes: row.notes || null,
    processed_by: row.processed_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function getProviderSettlementSummary({
  client = pool,
  providerId,
  limit = 50,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureProviderPayoutSchema(client);
  }

  const [accounts, totals, history] = await Promise.all([
    listProviderPayoutAccounts({
      client,
      providerId,
      ensureSchema: false,
    }),
    client.query(
      `
      SELECT
        COALESCE(SUM(amount) FILTER (
          WHERE status = ANY($2::text[])
        ), 0)::numeric AS pending_earnings,
        COALESCE(SUM(amount) FILTER (
          WHERE status = ANY($3::text[])
        ), 0)::numeric AS paid_earnings
      FROM provider_settlements
      WHERE provider_id=$1
      `,
      [providerId, PENDING_SETTLEMENT_STATUSES, PAID_SETTLEMENT_STATUSES]
    ),
    client.query(
      `
      SELECT *
      FROM provider_settlements
      WHERE provider_id=$1
      ORDER BY COALESCE(paid_at, updated_at, created_at) DESC, id DESC
      LIMIT $2
      `,
      [providerId, normalizeLimit(limit, 50)]
    ),
  ]);

  return {
    payout_account: accounts.active_account,
    payout_accounts: accounts.accounts,
    earnings: {
      pending: Number(totals.rows[0]?.pending_earnings || 0),
      paid: Number(totals.rows[0]?.paid_earnings || 0),
    },
    settlements: history.rows.map(serializeSettlement),
  };
}

function normalizeAdminSettlementFilter(value) {
  const filter = String(value || "pending").trim().toLowerCase();
  return ["pending", "paid", "failed", "all"].includes(filter)
    ? filter
    : "pending";
}

function adminSettlementFilterClause(filter) {
  if (filter === "pending") {
    return `ps.status = ANY($2::text[])`;
  }
  if (filter === "paid") {
    return `ps.status = ANY($3::text[])`;
  }
  if (filter === "failed") {
    return `ps.status = ANY($4::text[])`;
  }
  return `ps.status = ANY($5::text[])`;
}

function payoutAccountSummary(row) {
  if (!row.payout_account_id) return null;
  const account = serializePayoutAccount({
    id: row.payout_account_id,
    provider_id: row.provider_id,
    account_type: row.payout_account_type,
    upi_id: row.payout_upi_id,
    account_holder_name: row.payout_account_holder_name,
    bank_account_number: row.payout_bank_account_number,
    ifsc_code: row.payout_ifsc_code,
    is_active: true,
    is_verified: row.payout_is_verified,
    created_at: row.payout_created_at,
    updated_at: row.payout_updated_at,
  });

  return account;
}

function serializeAdminSettlement(row) {
  return {
    ...serializeSettlement(row),
    provider_name: row.provider_name || row.restaurant_name || row.provider_phone || "Provider",
    provider_phone: row.provider_phone || null,
    restaurant_name: row.restaurant_name || null,
    amount_due: Number(row.amount_due || 0),
    pending_settlements: Number(row.pending_settlements || 0),
    last_settlement_at: row.last_settlement_at || null,
    payout_account: payoutAccountSummary(row),
  };
}

function summarizeAdminSettlements(rows) {
  const summary = new Map();

  for (const row of rows) {
    if (summary.has(row.provider_id)) continue;
    summary.set(row.provider_id, {
      provider_id: row.provider_id,
      provider_name: row.provider_name,
      provider_phone: row.provider_phone,
      restaurant_name: row.restaurant_name,
      amount_due: row.amount_due,
      pending_settlements: row.pending_settlements,
      last_settlement_at: row.last_settlement_at,
      payout_account: row.payout_account,
    });
  }

  return Array.from(summary.values());
}

async function listAdminProviderSettlements({
  client = pool,
  status = "pending",
  limit = DEFAULT_ADMIN_SETTLEMENT_LIMIT,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureProviderPayoutSchema(client);
  }

  const filter = normalizeAdminSettlementFilter(status);
  const allStatuses = [
    ...PENDING_SETTLEMENT_STATUSES,
    ...PAID_SETTLEMENT_STATUSES,
    ...FAILED_SETTLEMENT_STATUSES,
    ...FINAL_SETTLEMENT_STATUSES,
  ];
  const result = await client.query(
    `
    WITH provider_due AS (
      SELECT
        provider_id,
        COALESCE(SUM(amount) FILTER (
          WHERE status = ANY($2::text[])
        ), 0)::numeric AS amount_due,
        COUNT(*) FILTER (
          WHERE status = ANY($2::text[])
        )::int AS pending_settlements,
        MAX(COALESCE(paid_at, updated_at, created_at)) AS last_settlement_at
      FROM provider_settlements
      GROUP BY provider_id
    ),
    active_accounts AS (
      SELECT DISTINCT ON (provider_id) *
      FROM provider_payout_accounts
      WHERE is_active=true
      ORDER BY provider_id, created_at DESC, id DESC
    )
    SELECT
      ps.*,
      u.name AS provider_name,
      u.phone AS provider_phone,
      r.restaurant_name,
      COALESCE(pd.amount_due, 0) AS amount_due,
      COALESCE(pd.pending_settlements, 0) AS pending_settlements,
      pd.last_settlement_at,
      ppa.id AS payout_account_id,
      ppa.account_type AS payout_account_type,
      ppa.upi_id AS payout_upi_id,
      ppa.account_holder_name AS payout_account_holder_name,
      ppa.bank_account_number AS payout_bank_account_number,
      ppa.ifsc_code AS payout_ifsc_code,
      ppa.is_verified AS payout_is_verified,
      ppa.created_at AS payout_created_at,
      ppa.updated_at AS payout_updated_at
    FROM provider_settlements ps
    JOIN users u ON u.id=ps.provider_id
    LEFT JOIN restaurants r ON r.user_id=ps.provider_id
    LEFT JOIN provider_due pd ON pd.provider_id=ps.provider_id
    LEFT JOIN active_accounts ppa ON ppa.provider_id=ps.provider_id
    WHERE ${adminSettlementFilterClause(filter)}
    ORDER BY
      CASE
        WHEN ps.status = ANY($2::text[]) THEN 0
        WHEN ps.status = ANY($4::text[]) THEN 1
        ELSE 2
      END,
      COALESCE(ps.paid_at, ps.updated_at, ps.created_at) DESC,
      ps.id DESC
    LIMIT $1
    `,
    [
      normalizeLimit(limit),
      PENDING_SETTLEMENT_STATUSES,
      PAID_SETTLEMENT_STATUSES,
      FAILED_SETTLEMENT_STATUSES,
      allStatuses,
    ]
  );
  const settlements = result.rows.map(serializeAdminSettlement);

  return {
    filter,
    summary: summarizeAdminSettlements(settlements),
    settlements,
  };
}

function normalizePaidAt(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw serviceError("Paid at must be a valid timestamp.");
  }
  return date.toISOString();
}

async function loadSettlementForUpdate(client, settlementId) {
  const result = await client.query(
    `
    SELECT *
    FROM provider_settlements
    WHERE id=$1
    FOR UPDATE
    `,
    [settlementId]
  );

  return result.rows[0] || null;
}

async function transitionProviderSettlementStatus({
  client,
  settlementId,
  status,
  adminId,
  paymentReference,
  paidAt,
  notes,
  ensureSchema = true,
} = {}) {
  const nextStatus = String(status || "").trim().toLowerCase();
  if (!["paid", "failed"].includes(nextStatus)) {
    throw serviceError("Settlement can only be marked paid or failed.");
  }

  const transitionSettlementStatus = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const current = await loadSettlementForUpdate(db, settlementId);
    if (!current) return null;

    if (current.status === "paid" && nextStatus === "failed") {
      throw serviceError("Paid settlement cannot be marked failed.", 409, "SETTLEMENT_ALREADY_PAID");
    }

    const reference = trimText(paymentReference || "", 120);
    const settlementNotes = trimText(notes || "", 1000);
    const paidAtValue = nextStatus === "paid" ? normalizePaidAt(paidAt) : null;

    if (nextStatus === "paid" && !reference && !current.payment_reference) {
      throw serviceError("Payment reference is required when marking paid.");
    }

    const result = await db.query(
      `
      UPDATE provider_settlements
      SET status=$2,
          paid_at=CASE
            WHEN $2='paid' THEN COALESCE($3::timestamp, paid_at, NOW())
            ELSE paid_at
          END,
          payment_reference=CASE
            WHEN $4 <> '' THEN $4
            ELSE payment_reference
          END,
          notes=CASE
            WHEN $5 <> '' THEN $5
            ELSE notes
          END,
          processed_by=$6,
          updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [
        settlementId,
        nextStatus,
        paidAtValue,
        reference,
        settlementNotes,
        adminId || null,
      ]
    );

    return serializeSettlement(result.rows[0]);
  };

  if (client) return transitionSettlementStatus(client);

  return withTransaction(pool, transitionSettlementStatus, {
    name: "transition_provider_settlement_status",
    maxAttempts: 3,
  });
}

async function updateProviderSettlementNotes({
  client,
  settlementId,
  adminId,
  notes,
  ensureSchema = true,
} = {}) {
  const settlementNotes = trimText(notes || "", 1000);
  const saveSettlementNotes = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const result = await db.query(
      `
      UPDATE provider_settlements
      SET notes=$2, processed_by=$3, updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [settlementId, settlementNotes || null, adminId || null]
    );

    return result.rows[0] ? serializeSettlement(result.rows[0]) : null;
  };

  if (client) return saveSettlementNotes(client);

  return withTransaction(pool, saveSettlementNotes, {
    name: "update_provider_settlement_notes",
    maxAttempts: 3,
  });
}

module.exports = {
  ACCOUNT_TYPES,
  FINAL_SETTLEMENT_STATUSES,
  FAILED_SETTLEMENT_STATUSES,
  PAID_SETTLEMENT_STATUSES,
  PENDING_SETTLEMENT_STATUSES,
  deactivateProviderPayoutAccount,
  ensureProviderPayoutSchema,
  getProviderSettlementSummary,
  listAdminProviderSettlements,
  listProviderPayoutAccounts,
  normalizeSettlementStatus,
  replaceProviderPayoutAccount,
  transitionProviderSettlementStatus,
  updateProviderSettlementNotes,
  validatePayoutAccountInput,
};
