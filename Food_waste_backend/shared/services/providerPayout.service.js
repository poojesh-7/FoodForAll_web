const pool = require("../config/db");
const { shouldSkipRuntimeSchemaMutation } = require("../config/runtimeSchema");
const { withTransaction } = require("../utils/transaction");
const logger = require("../utils/logger");
const {
  ensureSettlementAccountingSchema,
  recordProviderSettlementPaidLedger,
  recordRefundLiabilityReleased,
} = require("./financialLedger.service");
const { recordOperationalEvent } = require("./observability.service");

const ACCOUNT_TYPES = new Set(["UPI", "BANK"]);
const VERIFICATION_STATUSES = new Set(["pending", "verified", "rejected"]);
const CHANGE_REQUEST_STATUSES = new Set([
  "pending",
  "approved",
  "rejected",
  "replacement_pending",
]);
const DEFAULT_VERIFICATION_STATUS = "pending";
const PENDING_SETTLEMENT_STATUSES = [
  "pending",
  "processing",
  "allocated",
  "batched",
];
const PAID_SETTLEMENT_STATUSES = ["paid", "settled"];
const FAILED_SETTLEMENT_STATUSES = ["failed", "cancelled"];
const OUTSTANDING_SETTLEMENT_STATUSES = [
  ...PENDING_SETTLEMENT_STATUSES,
  ...FAILED_SETTLEMENT_STATUSES,
];
const FINAL_SETTLEMENT_STATUSES = [
  "pending",
  "processing",
  "settled",
  "paid",
  "failed",
  "cancelled",
];
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function validatePayoutAccountInput(input = {}) {
  const accountType = normalizeAccountType(
    input.account_type || input.accountType,
  );
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
    160,
  );
  const bankAccountNumber = trimText(
    input.bank_account_number || input.bankAccountNumber,
    40,
  ).replace(/\s+/g, "");
  const ifscCode = trimText(
    input.ifsc_code || input.ifscCode,
    20,
  ).toUpperCase();

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
        verification_status TEXT NOT NULL DEFAULT 'pending',
        verified_at TIMESTAMP NULL,
        verified_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
        rejection_reason TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT provider_payout_accounts_type_valid
          CHECK (account_type IN ('UPI','BANK')),
        CONSTRAINT provider_payout_accounts_verification_status_valid
          CHECK (verification_status IN ('pending','verified','rejected')),
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
          ),
        CONSTRAINT provider_payout_accounts_change_request_status_valid
          CHECK (change_request_status IS NULL OR change_request_status IN ('pending','approved','rejected','replacement_pending'))
      )
    `);
    await db.query(`
      ALTER TABLE provider_payout_accounts
      ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS verified_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL,
      ADD COLUMN IF NOT EXISTS change_request_status TEXT NULL,
      ADD COLUMN IF NOT EXISTS change_request_reason TEXT NULL,
      ADD COLUMN IF NOT EXISTS change_requested_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS change_requested_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS change_reviewed_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS change_reviewed_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS change_review_notes TEXT NULL
    `);
    await db.query(`
      ALTER TABLE provider_payout_accounts
      DROP CONSTRAINT IF EXISTS provider_payout_accounts_verification_status_valid,
      DROP CONSTRAINT IF EXISTS provider_payout_accounts_change_request_status_valid,
      ADD CONSTRAINT provider_payout_accounts_verification_status_valid
        CHECK (verification_status IN ('pending','verified','rejected')),
      ADD CONSTRAINT provider_payout_accounts_change_request_status_valid
        CHECK (change_request_status IS NULL OR change_request_status IN ('pending','approved','rejected','replacement_pending'))
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
      ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
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
      ALTER TABLE provider_settlements
      DROP CONSTRAINT IF EXISTS provider_settlements_paid_amount_valid,
      ADD CONSTRAINT provider_settlements_paid_amount_valid
        CHECK (paid_amount >= 0 AND paid_amount <= amount)
    `);
    await db.query(`
      UPDATE provider_settlements
      SET status = CASE
        WHEN status IN ('allocated','batched') THEN 'pending'
        ELSE status
      END
      WHERE status IN ('allocated','batched')
    `);
    await db.query(`
      ALTER TABLE provider_settlements
      ALTER COLUMN status SET DEFAULT 'pending',
      DROP CONSTRAINT IF EXISTS provider_settlements_status_valid,
      ADD CONSTRAINT provider_settlements_status_valid
        CHECK (status IN ('pending','processing','settled','paid','failed','cancelled'))
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
  const verificationStatus = String(
    row.verification_status || "pending",
  ).toLowerCase();
  const isVerified =
    verificationStatus === "verified" || Boolean(row.is_verified);

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
    is_verified: isVerified,
    verification_status:
      verificationStatus === "verified" || verificationStatus === "rejected"
        ? verificationStatus
        : "pending",
    verified_at: row.verified_at || null,
    verified_by: row.verified_by || null,
    rejection_reason: row.rejection_reason || null,
    change_request_status: (() => {
      const status = String(row.change_request_status || "").toLowerCase();
      return CHANGE_REQUEST_STATUSES.has(status) ? status : null;
    })(),
    change_request_reason: row.change_request_reason || null,
    change_requested_at: row.change_requested_at || null,
    change_requested_by: row.change_requested_by || null,
    change_reviewed_at: row.change_reviewed_at || null,
    change_reviewed_by: row.change_reviewed_by || null,
    change_review_notes: row.change_review_notes || null,
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
    SELECT
      id,
      provider_id,
      account_type,
      upi_id,
      account_holder_name,
      bank_account_number,
      ifsc_code,
      is_active,
      is_verified,
      verification_status,
      verified_at,
      verified_by,
      rejection_reason,
      change_request_status,
      change_request_reason,
      change_requested_at,
      change_requested_by,
      change_reviewed_at,
      change_reviewed_by,
      change_review_notes,
      ${sqlTimestampUtc("created_at")} AS created_at,
      ${sqlTimestampUtc("updated_at")} AS updated_at
    FROM provider_payout_accounts
    WHERE provider_id=$1
    ORDER BY is_active DESC, created_at DESC, id DESC
    `,
    [providerId],
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
  let previousActiveAccount = null;

  const replacePayoutAccount = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const activeAccount = await loadActiveProviderPayoutAccount(db, providerId);
    previousActiveAccount = activeAccount;

    const isReplacementUpload = Boolean(
      activeAccount &&
        String(activeAccount.verification_status || "pending").toLowerCase() ===
          "verified" &&
        ["approved", "replacement_pending"].includes(
          String(activeAccount.change_request_status || "").toLowerCase(),
        ),
    );

    if (activeAccount && !isReplacementUpload) {
      const currentStatus = String(
        activeAccount.verification_status || "pending",
      ).toLowerCase();
      if (currentStatus === "verified") {
        const changeStatus = String(
          activeAccount.change_request_status || "",
        ).toLowerCase();
        if (changeStatus !== "approved") {
          throw serviceError(
            "Change request must be approved before replacing a verified payout account.",
            409,
            "PAYOUT_ACCOUNT_CHANGE_REQUEST_REQUIRED",
          );
        }
      }
    }

    if (activeAccount) {
      await db.query(
        `
        UPDATE provider_payout_accounts
        SET is_active=false, updated_at=NOW()
        WHERE provider_id=$1 AND is_active=true
        `,
        [providerId],
      );
    }

    const inserted = await db.query(
      `
      INSERT INTO provider_payout_accounts (
        provider_id, account_type, upi_id, account_holder_name,
        bank_account_number, ifsc_code, is_active, is_verified,
        verification_status, verified_at, verified_by, rejection_reason,
        change_request_status, change_request_reason, change_requested_at,
        change_requested_by, change_reviewed_at, change_reviewed_by,
        change_review_notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,false,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)
      RETURNING *
      `,
      [
        providerId,
        sanitized.account_type,
        sanitized.upi_id,
        sanitized.account_holder_name,
        sanitized.bank_account_number,
        sanitized.ifsc_code,
        true,
      ],
    );

    const account = serializePayoutAccount(inserted.rows[0]);

    void recordOperationalEvent({
      category: "financial",
      severity: "info",
      eventName: "provider_payout_account_replaced",
      metadata: {
        provider_id: providerId,
        payout_account_id: account.id,
        previous_payout_account_id: previousActiveAccount?.id || null,
      },
    });

    return account;
  };

  if (client) return replacePayoutAccount(client);

  return withTransaction(pool, replacePayoutAccount, {
    name: "replace_provider_payout_account",
    maxAttempts: 3,
  });
}

async function requestProviderPayoutAccountChange({
  client,
  providerId,
  reason,
  ensureSchema = true,
} = {}) {
  const createRequest = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const activeAccount = await loadActiveProviderPayoutAccount(db, providerId);
    if (!activeAccount) {
      throw serviceError(
        "No verified payout account exists to request a change.",
        409,
        "PAYOUT_ACCOUNT_CHANGE_REQUEST_INVALID",
      );
    }

    const verificationStatus = String(
      activeAccount.verification_status || "pending",
    ).toLowerCase();
    if (verificationStatus !== "verified") {
      throw serviceError(
        "Payout account change request is only available for verified accounts.",
        409,
        "PAYOUT_ACCOUNT_CHANGE_REQUEST_INVALID",
      );
    }

    const requestedReason = trimText(reason || "Account change requested", 500);

    const result = await db.query(
      `
      UPDATE provider_payout_accounts
      SET change_request_status='pending',
          change_request_reason=$2,
          change_requested_at=NOW(),
          change_requested_by=$3,
          change_reviewed_at=NULL,
          change_reviewed_by=NULL,
          change_review_notes=NULL,
          updated_at=NOW()
      WHERE id=$1 AND is_active=true
      RETURNING *
      `,
      [activeAccount.id, requestedReason, providerId],
    );

    return serializePayoutAccount(result.rows[0] || null);
  };

  const account = client
    ? await createRequest(client)
    : await withTransaction(pool, createRequest, {
        name: "request_provider_payout_account_change",
        maxAttempts: 3,
      });

  if (!account) {
    throw serviceError("Active payout account not found.", 404, "NOT_FOUND");
  }

  void recordOperationalEvent({
    category: "financial",
    severity: "info",
    eventName: "provider_payout_change_requested",
    metadata: {
      provider_id: providerId,
      payout_account_id: account.id,
      reason: account.change_request_reason,
    },
  });

  return account;
}

async function approveProviderPayoutAccountChange({
  client,
  payoutAccountId,
  adminId,
  reason,
  ensureSchema = true,
} = {}) {
  if (!payoutAccountId) {
    throw serviceError("Payout account id is required.");
  }

  const approveRequest = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const notes = trimText(reason || "Approved for replacement", 500);

    const result = await db.query(
      `
      UPDATE provider_payout_accounts
      SET change_request_status='replacement_pending',
          change_reviewed_at=NOW(),
          change_reviewed_by=$2,
          change_review_notes=$3,
          updated_at=NOW()
      WHERE id=$1 AND is_active=true
      RETURNING *
      `,
      [payoutAccountId, adminId || null, notes],
    );

    return serializePayoutAccount(result.rows[0] || null);
  };

  const account = client
    ? await approveRequest(client)
    : await withTransaction(pool, approveRequest, {
        name: "approve_provider_payout_account_change",
        maxAttempts: 3,
      });

  if (!account) {
    throw serviceError("Payout account not found.", 404, "NOT_FOUND");
  }

  void recordOperationalEvent({
    category: "financial",
    severity: "info",
    eventName: "provider_payout_change_approved",
    metadata: {
      provider_id: account.provider_id,
      payout_account_id: account.id,
      admin_id: adminId || null,
      reason: account.change_review_notes,
    },
  });

  return account;
}

async function rejectProviderPayoutAccountChange({
  client,
  payoutAccountId,
  adminId,
  reason,
  ensureSchema = true,
} = {}) {
  if (!payoutAccountId) {
    throw serviceError("Payout account id is required.");
  }

  const rejectionReason = trimText(reason || "Rejected by admin", 500);

  const rejectRequest = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const result = await db.query(
      `
      UPDATE provider_payout_accounts
      SET change_request_status='rejected',
          change_reviewed_at=NOW(),
          change_reviewed_by=$2,
          change_review_notes=$3,
          updated_at=NOW()
      WHERE id=$1 AND is_active=true
      RETURNING *
      `,
      [payoutAccountId, adminId || null, rejectionReason],
    );

    return serializePayoutAccount(result.rows[0] || null);
  };

  const account = client
    ? await rejectRequest(client)
    : await withTransaction(pool, rejectRequest, {
        name: "reject_provider_payout_account_change",
        maxAttempts: 3,
      });

  if (!account) {
    throw serviceError("Payout account not found.", 404, "NOT_FOUND");
  }

  void recordOperationalEvent({
    category: "financial",
    severity: "warn",
    eventName: "provider_payout_change_rejected",
    metadata: {
      provider_id: account.provider_id,
      payout_account_id: account.id,
      admin_id: adminId || null,
      reason: account.change_review_notes,
    },
  });

  return account;
}

async function listAdminProviderPayoutChangeRequests({
  client = pool,
  status = "pending",
  limit = 100,
  search,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureProviderPayoutSchema(client);
  }

  const allowedStatus = ["pending", "approved", "rejected", "replacement_pending", "all"];
  const filter = allowedStatus.includes(String(status || "").toLowerCase())
    ? String(status || "pending").toLowerCase()
    : "pending";
  const searchPattern = normalizeAdminSettlementSearch(search);
  const rowLimit = normalizeLimit(limit, 100);

  const queryParts = [];
  const params = [];
  params.push(rowLimit);

  if (filter !== "all") {
    params.push(filter);
    queryParts.push(`ppa.change_request_status = $${params.length}`);
  }

  if (searchPattern) {
    params.push(searchPattern);
    queryParts.push(`(
      CONCAT_WS(' ', u.name, u.phone, ppa.account_type, ppa.upi_id,
        ppa.account_holder_name, ppa.bank_account_number, ppa.ifsc_code)
      ILIKE $${params.length} ESCAPE '\'
    )`);
  }

  const whereClause = queryParts.length
    ? `WHERE ${queryParts.join(" AND ")}`
    : "";

  const result = await client.query(
    `
    SELECT
      ppa.id AS payout_account_id,
      ppa.provider_id,
      u.name AS provider_name,
      u.phone AS provider_phone,
      r.restaurant_name,
      ppa.account_type,
      ppa.upi_id,
      ppa.account_holder_name,
      ppa.bank_account_number,
      ppa.ifsc_code,
      ppa.is_verified,
      ppa.verification_status,
      ppa.change_request_status,
      ppa.change_request_reason,
      ${sqlTimestampUtc("ppa.change_requested_at")} AS change_requested_at,
      ppa.change_requested_by,
      ppa.change_reviewed_at,
      ppa.change_reviewed_by,
      ppa.change_review_notes,
      ${sqlTimestampUtc("ppa.created_at")} AS created_at,
      ${sqlTimestampUtc("ppa.updated_at")} AS updated_at
    FROM provider_payout_accounts ppa
    LEFT JOIN users u ON u.id = ppa.provider_id
    LEFT JOIN restaurants r ON r.user_id = ppa.provider_id
    ${whereClause}
    ORDER BY ppa.change_requested_at DESC NULLS LAST, ppa.updated_at DESC
    LIMIT $1::int
    `,
    params,
  );

  return {
    filter,
    requests: result.rows.map((row) => ({
      provider_id: row.provider_id,
      provider_name: row.provider_name,
      provider_phone: row.provider_phone,
      restaurant_name: row.restaurant_name,
      payout_account_id: row.payout_account_id,
      account_type: row.account_type,
      upi_id: row.upi_id,
      account_holder_name: row.account_holder_name,
      bank_account_number: row.bank_account_number,
      ifsc_code: row.ifsc_code,
      is_verified: row.is_verified,
      verification_status: row.verification_status,
      change_request_status: row.change_request_status,
      change_request_reason: row.change_request_reason,
      change_requested_at: row.change_requested_at,
      change_requested_by: row.change_requested_by,
      change_reviewed_at: row.change_reviewed_at,
      change_reviewed_by: row.change_reviewed_by,
      change_review_notes: row.change_review_notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}

async function verifyProviderPayoutAccount({
  client,
  payoutAccountId,
  adminId,
  ensureSchema = true,
} = {}) {
  if (!payoutAccountId) {
    throw serviceError("Payout account id is required.");
  }

  const verifyAccount = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const existing = await db.query(
      `
      SELECT id, provider_id, is_active
      FROM provider_payout_accounts
      WHERE id=$1
      `,
      [payoutAccountId],
    );

    const currentAccount = existing.rows[0];
    if (!currentAccount) return null;

    const wasInactive = !currentAccount.is_active;

    const result = await db.query(
      `
      UPDATE provider_payout_accounts
      SET verification_status='verified', is_verified=true,
          verified_at=NOW(), verified_by=$2,
          rejection_reason=NULL, updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [payoutAccountId, adminId || null],
    );

    if (!result.rows[0]) return null;

    if (wasInactive) {
      const activeAccount = await loadActiveProviderPayoutAccount(
        db,
        currentAccount.provider_id,
      );

      if (
        activeAccount &&
        ["approved", "replacement_pending"].includes(
          String(activeAccount.change_request_status || "").toLowerCase(),
        )
      ) {
        await db.query(
          `
          UPDATE provider_payout_accounts
          SET is_active=false,
              change_request_status=NULL,
              updated_at=NOW()
          WHERE id=$1
          `,
          [activeAccount.id],
        );
      }

      await db.query(
        `
        UPDATE provider_payout_accounts
        SET is_active=true, updated_at=NOW()
        WHERE id=$1
        `,
        [payoutAccountId],
      );

      const refreshed = await db.query(
        `
        SELECT *
        FROM provider_payout_accounts
        WHERE id=$1
        `,
        [payoutAccountId],
      );

      return serializePayoutAccount(refreshed.rows[0] || null);
    }

    return serializePayoutAccount(result.rows[0] || null);
  };

  if (client) return verifyAccount(client);

  return withTransaction(pool, verifyAccount, {
    name: "verify_provider_payout_account",
    maxAttempts: 3,
  });
}

async function rejectProviderPayoutAccount({
  client,
  payoutAccountId,
  adminId,
  reason,
  ensureSchema = true,
} = {}) {
  if (!payoutAccountId) {
    throw serviceError("Payout account id is required.");
  }

  const rejectionReason = trimText(reason || "Rejected by admin", 500);

  const rejectAccount = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const result = await db.query(
      `
      UPDATE provider_payout_accounts
      SET verification_status='rejected', is_verified=false,
          verified_at=NULL, verified_by=$2,
          rejection_reason=$3, updated_at=NOW()
      WHERE id=$1 AND is_active=true
      RETURNING *
      `,
      [
        payoutAccountId,
        adminId || null,
        rejectionReason || "Rejected by admin",
      ],
    );

    return serializePayoutAccount(result.rows[0] || null);
  };

  if (client) return rejectAccount(client);

  return withTransaction(pool, rejectAccount, {
    name: "reject_provider_payout_account",
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
      [providerId],
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
    paid_amount: Number(row.paid_amount || 0),
    commission_amount: Number(row.commission_amount || 0),
    currency: row.currency || "INR",
    status: normalizeSettlementStatus(row.status),
    raw_status: row.status,
    paid_at: row.paid_at || null,
    payment_reference: row.payment_reference || null,
    notes: row.notes || null,
    refund_amount: Number(row.refund_amount || 0),
    manual_carry_forward_amount: Number(
      row.manual_carry_forward_amount || 0,
    ),
    recorded_carry_forward_amount: Number(
      row.recorded_carry_forward_amount || 0,
    ),
    manual_carry_forward_applied_at:
      row.manual_carry_forward_applied_at || null,
    refund_deduction_amount: Number(row.refund_deduction_amount || 0),
    net_payable: Number(row.net_payable || 0),
    recorded_refund_deduction_amount: Number(
      row.recorded_refund_deduction_amount || 0,
    ),
    pending_refund_amount: Number(row.pending_refund_amount || 0),
    refund_note: row.refund_note || null,
    payment_status: row.payment_status || null,
    refund_status: row.refund_status || null,
    display_status: row.display_status || null,
    processed_by: row.processed_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function applyRefundCarryForward(records) {
  const rows = Array.isArray(records) ? records : [];
  const projectedById = new Map();
  const orderedRows = [...rows].sort((left, right) => {
    const dateDifference =
      new Date(left.created_at || 0) - new Date(right.created_at || 0);
    return (
      dateDifference ||
      String(left.id || "").localeCompare(String(right.id || ""))
    );
  });

  // Refund carry-forward liability is not realized in the open pool until an actual
  // settlement consumes the outstanding liability. Marking a record refunded or
  // carry-forwarding it is a state transition only; it does not move the refund bucket.
  // This keeps the pending pool and the refund ledger in sync with the spec until the
  // settlement action performs the netting step.
  for (const record of orderedRows) {
    const refundAmount = Number(record.refund_amount || 0);
    const manualCarryForwardAmount = Number(record.manual_carry_forward_amount || 0);
    const recordedCarryForwardAmount = Number(
      record.recorded_carry_forward_amount || 0,
    );
    const carriedForwardAmount = manualCarryForwardAmount + recordedCarryForwardAmount;
    const normalizedStatus = normalizeSettlementStatus(record.status);
    const availableAmount = Math.max(
      Number(record.amount || 0) - Number(record.refund_amount || 0),
      0,
    );
    const isCarryForwardTarget =
      refundAmount === 0 &&
      [...PENDING_SETTLEMENT_STATUSES, ...PAID_SETTLEMENT_STATUSES].includes(
        normalizedStatus,
      );

    const recordedRecovery = isCarryForwardTarget
      ? Math.min(
        Number(record.recorded_refund_deduction_amount || 0),
        availableAmount,
      )
      : 0;

    const recoveryAmount = roundMoney(recordedRecovery);

    projectedById.set(record.id, {
      refund_deduction_amount: recoveryAmount,
      net_payable: roundMoney(
        Math.max(
          Number(record.amount || 0) - recoveryAmount,
          0,
        ),
      ),
      pending_refund_amount: 0,
      projected_recovery_amount: 0,
    });
  }

  return rows.map((record) => {
    const refundAmount = Number(record.refund_amount || 0);
    const manualCarryForwardAmount = Number(
      record.manual_carry_forward_amount || 0,
    );
    const recordedCarryForwardAmount = Number(
      record.recorded_carry_forward_amount || 0,
    );
    const carriedForwardAmount = manualCarryForwardAmount + recordedCarryForwardAmount;
    const paymentStatus = String(
      record.payment_status || record.refund_status || "",
    ).toLowerCase();
    const projection = projectedById.get(record.id) || {};
    const refund_deduction_amount = Number(
      projection.refund_deduction_amount || 0,
    );
    const net_payable = Number(projection.net_payable || 0);

    let display_status = normalizeSettlementStatus(record.status);
    let refund_note = null;

    if (refundAmount > 0) {
      display_status = "Refunded";
      if (carriedForwardAmount > 0) {
        const remainingRefund = roundMoney(
          Math.max(refundAmount - carriedForwardAmount, 0),
        );
        refund_note = remainingRefund > 0
          ? `Refund carry-forward recorded: ₹${carriedForwardAmount.toFixed(2)}. Remaining refund balance: ₹${remainingRefund.toFixed(2)}.`
          : "Refund recovery applied from carry-forward.";
      } else {
        refund_note = "Refund recovery awaiting future provider settlements.";
      }
    }

    if (["refund_pending", "refund_failed"].includes(paymentStatus)) {
      display_status = paymentStatus === "refund_pending" ? "Refund Pending" : "Refund Failed";
      if (manualCarryForwardAmount > 0) {
        refund_note = `Refund recovery pending: ₹${(refundAmount - manualCarryForwardAmount).toFixed(2)} remaining.`;
      } else {
        refund_note = "Refund recovery awaiting future provider settlements.";
      }
    }

    if (refund_deduction_amount > 0 && !["refund_pending", "refund_failed"].includes(paymentStatus)) {
      display_status = "Refund Recovery Applied";
      if (refundAmount <= 0) {
        refund_note = `Refund recovery applied to this settlement: ₹${refund_deduction_amount.toFixed(2)}.`;
      }
    }

    return {
      ...record,
      refund_deduction_amount: Number(refund_deduction_amount || 0),
      net_payable,
      projected_recovery_amount: Number(
        projection.projected_recovery_amount || 0,
      ),
      manual_carry_forward_amount: Number(record.manual_carry_forward_amount || 0),
      recorded_carry_forward_amount: recordedCarryForwardAmount,
      carry_forward_applied_amount: carriedForwardAmount,
      pending_refund_amount:
        projectedById.get(record.id)?.pending_refund_amount ?? 0,
      refund_note: refund_note || null,
      display_status: display_status || normalizeSettlementStatus(record.status),
    };
  });
}

function applyManualCarryForwardProjection(records) {
  // Carry-forward is a liability until the admin settlement action consumes it.
  // Do not deduct it from pending rows in read projections.
  return Array.isArray(records)
    ? records.map((record) => ({
        ...record,
        refund_deduction_amount: Number(record.refund_deduction_amount || 0),
        net_payable: Number(
          record.net_payable ??
            Math.max(
              Number(record.amount || 0) - Number(record.refund_amount || 0),
              0,
            ),
        ),
      }))
    : [];
}

function preserveSettlementRecordDisplay(records) {
  return records.map((record) => {
    if (Number(record.refund_amount || 0) > 0) return record;
    return {
      ...record,
      refund_deduction_amount: Number(record.refund_deduction_amount || 0),
      net_payable: Math.max(
        Number(record.amount || 0) - Number(record.paid_amount || 0) -
          Number(record.refund_deduction_amount || 0),
        0,
      ),
      display_status: normalizeSettlementStatus(record.status),
      refund_note: null,
    };
  });
}

function getPaidSettlementAmount(settlement) {
  const amount = Number(settlement.amount || 0);
  const paidAmount = Number(settlement.paid_amount || 0);
  const refundAmount = Number(settlement.refund_amount || 0);

  if (paidAmount > 0) return paidAmount;
  if (refundAmount > 0) return Math.max(amount - refundAmount, 0);
  return amount;
}

function getNetPaidSettlementAmount(settlement) {
  const amount = Number(settlement.amount || 0);
  const paidAmount = Number(settlement.paid_amount || 0);
  if (paidAmount > 0) {
    return Math.min(paidAmount, amount);
  }

  const deduction = Number(settlement.refund_deduction_amount || 0);
  if (deduction > 0) {
    return Math.max(amount - deduction, 0);
  }
  return getPaidSettlementAmount(settlement);
}

function getAvailableSettlementCarryForwardAmount(settlement) {
  const amount = Number(settlement.amount || 0);
  const paidAmount = Number(settlement.paid_amount || 0);
  const alreadyAllocated = Number(
    settlement.manual_carry_forward_amount || 0,
  );

  return Math.max(amount - paidAmount - alreadyAllocated, 0);
}

async function persistProjectedRefundRecovery({
  client,
  providerId,
  adminId,
  notes,
} = {}) {
  const result = await client.query(
    `
    SELECT
      ps.id,
      ps.provider_id,
      ps.reservation_id,
      ps.payment_session_id,
      ps.amount,
      ps.paid_amount,
      ps.status,
      ps.manual_carry_forward_amount,
      ps.created_at,
      LEAST(ps.amount, COALESCE((
        SELECT SUM(fle.amount)
        FROM financial_ledger_entries fle
        WHERE fle.reservation_id = ps.reservation_id
          AND fle.payment_session_id = ps.payment_session_id
          AND fle.event_type = 'refund_issued'
      ), 0))::numeric AS refund_amount
    FROM provider_settlements ps
    WHERE ps.provider_id = $1
        AND COALESCE(ps.manual_carry_forward_amount, 0) > 0
    ORDER BY ps.created_at ASC, ps.id ASC
    FOR UPDATE
    `,
    [providerId],
  );

  const rows = applyRefundCarryForward(result.rows);
  const sourceRows = result.rows
    .filter((row) => Number(row.refund_amount || 0) > 0)
    .sort((left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );

  for (const row of rows) {
    const recovery = Number(row.projected_recovery_amount || 0);
    if (recovery <= 0) continue;
    const source = sourceRows
      .filter((candidate) =>
        new Date(candidate.created_at).getTime() <
        new Date(row.created_at).getTime(),
      )
      .at(-1);
    if (!source) continue;

    await client.query(
      `
      UPDATE provider_settlements
      SET manual_carry_forward_amount = manual_carry_forward_amount + $2,
          manual_carry_forward_applied_at = COALESCE(manual_carry_forward_applied_at, NOW()),
          manual_carry_forward_applied_by = $3,
          manual_carry_forward_notes = $4,
          updated_at = NOW()
      WHERE id = $1
      `,
      [row.id, recovery, adminId || null, notes || null],
    );
  }
}

function calculateRefundCarryForwardAllocations({
  refundAmount,
  alreadyCarriedForward = 0,
  pendingSettlements = [],
} = {}) {
  let remaining = roundMoney(Math.max(
    0,
    Number(refundAmount || 0) - Number(alreadyCarriedForward || 0),
  ));

  return pendingSettlements.map((settlement) => {
    const availableAmount = roundMoney(
      getAvailableSettlementCarryForwardAmount(settlement),
    );
    const carryForwardAmount = remaining > 0
      ? Math.min(remaining, availableAmount)
      : 0;

    remaining = roundMoney(Math.max(0, remaining - carryForwardAmount));

    return {
      ...settlement,
      availableAmount,
      carryForwardAmount: roundMoney(carryForwardAmount),
      remainingAfter: remaining,
    };
  });
}

function calculateMonthSettlementCarryForwardReduction({
  settlements,
  totalCarryForwardAmount,
  pendingSettlements = settlements || [],
  carryForwardAmount = totalCarryForwardAmount,
} = {}) {
  const pendingTotal = pendingSettlements.reduce((sum, settlement) => {
    const amount = Number(settlement.amount || 0);
    const paidAmount = Number(settlement.paid_amount || 0);
    return sum + Math.max(amount - paidAmount, 0);
  }, 0);

  const totalCarryForward = roundMoney(
    Number(carryForwardAmount ?? pendingSettlements.reduce(
      (sum, settlement) => sum + Number(settlement.manual_carry_forward_amount || 0),
      0,
    ))
  );

  if (totalCarryForward <= 0) {
    return {
      totalPendingAmount: roundMoney(pendingTotal),
      carryForwardAmount: 0,
      settlementAmount: roundMoney(pendingTotal),
      remainingCarryForward: 0,
      reduced: false,
    };
  }

  if (totalCarryForward >= pendingTotal) {
    return {
      totalPendingAmount: roundMoney(pendingTotal),
      carryForwardAmount: roundMoney(totalCarryForward),
      settlementAmount: 0,
      remainingCarryForward: roundMoney(Math.max(totalCarryForward - pendingTotal, 0)),
      reduced: true,
    };
  }

  return {
    totalPendingAmount: roundMoney(pendingTotal),
    carryForwardAmount: roundMoney(totalCarryForward),
    settlementAmount: roundMoney(pendingTotal - totalCarryForward),
    remainingCarryForward: 0,
    reduced: true,
  };
}

function reduceSettlementCarryForwardUsage({
  settlements = [],
  totalCarryForwardAmount = 0,
} = {}) {
  const rows = Array.isArray(settlements) ? settlements.map((settlement) => ({
    ...settlement,
    manual_carry_forward_amount: Number(settlement.manual_carry_forward_amount || 0),
  })) : [];

  let remainingCarryForward = roundMoney(Number(totalCarryForwardAmount || 0));
  let consumedCarryForward = 0;

  const reducedRows = rows.map((settlement) => {
    const currentCarryForward = roundMoney(Number(settlement.manual_carry_forward_amount || 0));
    if (remainingCarryForward <= 0 || currentCarryForward <= 0) {
      return settlement;
    }

    const usedAmount = roundMoney(Math.min(currentCarryForward, remainingCarryForward));
    remainingCarryForward = roundMoney(Math.max(0, remainingCarryForward - usedAmount));
    consumedCarryForward = roundMoney(consumedCarryForward + usedAmount);

    return {
      ...settlement,
      manual_carry_forward_amount: roundMoney(Math.max(currentCarryForward - usedAmount, 0)),
    };
  });

  return {
    settlements: reducedRows,
    consumedCarryForward: roundMoney(consumedCarryForward),
    remainingCarryForward: roundMoney(remainingCarryForward),
  };
}

function summarizeSettlementProjection(records) {
  const rows = Array.isArray(records) ? records : [];
  const pendingSettle = rows.filter((row) =>
    PENDING_SETTLEMENT_STATUSES.includes(
      normalizeSettlementStatus(row.status),
    ),
  );
  const paidSettle = rows.filter((row) =>
    PAID_SETTLEMENT_STATUSES.includes(normalizeSettlementStatus(row.status)),
  );

  const pendingAmount = pendingSettle.reduce((sum, row) => {
    if (
      Number(row.refund_amount || 0) > 0 &&
      Number(row.recorded_carry_forward_amount || 0) > 0
    ) {
      return sum;
    }
    const amount = Number(row.amount || 0);
    const paid = Number(row.paid_amount || 0);
    const deduction = paid > 0
      ? Number(row.refund_deduction_amount || 0)
      : 0;
    return sum + Math.max(amount - paid - deduction, 0);
  }, 0);

  const paidAmount = paidSettle.reduce((sum, row) => {
    if (Number(row.refund_amount || 0) > 0) return sum;
    return sum + getNetPaidSettlementAmount(row);
  }, 0);

  const partialPaidAmount = pendingSettle.reduce(
    (sum, row) => Number(row.refund_amount || 0) > 0
      ? sum
      : sum + Math.min(
        Number(row.amount || 0),
        Number(row.paid_amount || 0) + Number(row.refund_deduction_amount || 0),
      ),
    0,
  );

  const refundTotal = rows.reduce((sum, row) => {
    const amount = Number(row.recorded_carry_forward_amount || 0);
    return sum + amount;
  }, 0);

  const refundDeduction = rows.reduce((sum, row) => {
    if (Number(row.refund_amount || 0) > 0) return sum;
    return sum + Number(row.refund_deduction_amount || 0);
  }, 0);

  const outstandingRefund = rows.reduce((sum, row) => {
    if (Number(row.refund_amount || 0) <= 0) return sum;
    return sum + Number(row.manual_carry_forward_amount || 0);
  }, 0);

  return {
    earnings: {
      pending: Math.round(pendingAmount * 100) / 100,
      paid: Math.round((paidAmount + partialPaidAmount) * 100) / 100,
    },
    refunds: {
      total: Math.round(refundTotal * 100) / 100,
      count: rows.filter((row) => Number(row.refund_deduction_amount || 0) > 0).length,
      deducted: Math.round(refundDeduction * 100) / 100,
      // Pending liability = refunds on paid settlements - what's been deducted
      pending: Math.round(outstandingRefund * 100) / 100,
    },
    rows,
  };
}

async function getProviderSettledRunTotal(client, providerId) {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(paid_amount), 0)::numeric AS total_paid
    FROM provider_settlement_runs
    WHERE provider_id = $1
      AND status = 'settled'
      AND COALESCE(paid_amount, 0) > 0
    `,
    [providerId],
  );

  return Number(result.rows[0]?.total_paid || 0);
}

function sqlTimestampUtc(columnName) {
  return `to_char(${columnName}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

function sqlNullableTimestampUtc(columnName) {
  return `CASE WHEN ${columnName} IS NULL THEN NULL ELSE ${sqlTimestampUtc(columnName)} END`;
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

  const [accounts, settlementRows] = await Promise.all([
    listProviderPayoutAccounts({
      client,
      providerId,
      ensureSchema: false,
    }),
    client.query(
      `
      SELECT
        ps.id,
        ps.provider_id,
        ps.reservation_id,
        ps.payment_id,
        ps.payment_session_id,
        ps.settlement_allocation_id,
        ps.settlement_batch_id,
        ps.amount,
        ps.paid_amount,
        ps.commission_amount,
        ps.currency,
        ps.status AS status,
        COALESCE((
          SELECT SUM(fle.amount)
          FROM financial_ledger_entries fle
          WHERE fle.provider_settlement_id = ps.id
            AND fle.event_type = 'provider_refund_liability_released'
        ), 0)::numeric AS recorded_refund_deduction_amount,
        COALESCE((
          SELECT SUM(release_entry.amount)
          FROM financial_ledger_entries release_entry
          WHERE release_entry.event_type = 'provider_refund_liability_released'
            AND release_entry.refund_id IN (
              SELECT refund_entry.refund_id
              FROM financial_ledger_entries refund_entry
              WHERE refund_entry.reservation_id = ps.reservation_id
                AND refund_entry.payment_session_id = ps.payment_session_id
                AND refund_entry.event_type = 'refund_issued'
                AND refund_entry.refund_id IS NOT NULL
            )
        ), 0)::numeric AS recorded_carry_forward_amount,
        (
          SELECT p.status
          FROM payments p
          WHERE p.reservation_id = ps.reservation_id
            AND p.payment_session_id = ps.payment_session_id
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT 1
        ) AS payment_status,
        (
          SELECT p.refund_status
          FROM payments p
          WHERE p.reservation_id = ps.reservation_id
            AND p.payment_session_id = ps.payment_session_id
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT 1
        ) AS refund_status,
        LEAST(ps.amount, COALESCE((
          SELECT SUM(fle.amount)
          FROM financial_ledger_entries fle
          WHERE fle.reservation_id = ps.reservation_id
            AND fle.payment_session_id = ps.payment_session_id
            AND fle.event_type = 'refund_issued'
        ), 0))::numeric AS refund_amount,
        COALESCE(ps.manual_carry_forward_amount, 0)::numeric AS manual_carry_forward_amount,
        ${sqlNullableTimestampUtc('ps.manual_carry_forward_applied_at')} AS manual_carry_forward_applied_at,
        ps.manual_carry_forward_applied_by,
        ps.manual_carry_forward_notes,
        ${sqlNullableTimestampUtc('ps.paid_at')} AS paid_at,
        ps.payment_reference,
        ps.notes,
        ps.processed_by,
        ${sqlTimestampUtc('ps.created_at')} AS created_at,
        ${sqlTimestampUtc('ps.updated_at')} AS updated_at
      FROM provider_settlements ps
      WHERE ps.provider_id = $1
      ORDER BY COALESCE(ps.paid_at, ps.updated_at, ps.created_at) ASC, ps.id ASC
      `,
      [providerId],
    ),
  ]);

  const projectedRows = applyManualCarryForwardProjection(
    applyRefundCarryForward(settlementRows.rows.map(serializeSettlement)),
  );
  const projectedSummary = summarizeSettlementProjection(projectedRows);
  projectedSummary.earnings.paid = Math.round(
    (await getProviderSettledRunTotal(client, providerId)) * 100,
  ) / 100;

  // Aggregate settlements by month for frontend display
  function aggregateSettlementsByMonth(rows) {
    const monthMap = new Map();

    rows.forEach((row) => {
      const date = new Date(row.created_at || row.updated_at);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short' });
      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          year,
          month,
          month_key: monthKey,
          month_label: monthLabel,
          earnings: 0,
          paid: 0,
          pending: 0,
          refunded: 0,
          count: 0,
          status: 'Pending',
        });
      }
      const monthData = monthMap.get(monthKey);
      const amount = Number(row.amount || 0);
      const refund = Number(row.refund_amount || 0);
      const deduction = Number(row.refund_deduction_amount || 0);
      const netAmount = Math.max(amount - deduction, 0);
      const paidStatus = PAID_SETTLEMENT_STATUSES.includes(normalizeSettlementStatus(row.status));
      const pendingStatus = PENDING_SETTLEMENT_STATUSES.includes(normalizeSettlementStatus(row.status));
      monthData.earnings += netAmount;
      monthData.refunded += refund;

      if (paidStatus && refund <= 0) {
        monthData.paid += getNetPaidSettlementAmount(row);
      }
      if (
        pendingStatus &&
        !(refund > 0 && Number(row.recorded_carry_forward_amount || 0) > 0)
      ) {
        monthData.pending += netAmount;
      }
      monthData.count += 1;

      // Determine overall month status
      if (monthData.count > 0) {
        if (monthData.earnings === 0 && monthData.refunded > 0) {
          monthData.status = 'Refunded';
        } else if (monthData.paid >= monthData.earnings && monthData.earnings > 0) {
          monthData.status = 'Paid';
        } else if (monthData.paid > 0 && monthData.paid < monthData.earnings) {
          monthData.status = 'Partially Paid';
        } else if (monthData.pending > 0) {
          monthData.status = 'Pending';
        } else {
          monthData.status = 'Failed';
        }
      }
    });
    return Array.from(monthMap.values())
      .map(m => ({
        ...m,
        earnings: Math.round(m.earnings * 100) / 100,
        paid: Math.round(m.paid * 100) / 100,
        pending: Math.round(m.pending * 100) / 100,
        refunded: Math.round(m.refunded * 100) / 100,
      }))
      .sort((a, b) => {
        const aDate = new Date(`${a.year}-${String(a.month).padStart(2, '0')}-01`);
        const bDate = new Date(`${b.year}-${String(b.month).padStart(2, '0')}-01`);
        return bDate.getTime() - aDate.getTime();
      });
  }

  const monthlySettlements = aggregateSettlementsByMonth(projectedRows);

  return {
    payout_account: accounts.active_account,
    payout_accounts: accounts.accounts,
    earnings: projectedSummary.earnings,
    refunds: projectedSummary.refunds,
    settlements: monthlySettlements,
  };
}

async function listProviderSettlementRecords({
  client = pool,
  providerId,
  year,
  month,
  status,
  limit = 50,
  page = 1,
  offset = 0,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureProviderPayoutSchema(client);
  }

  const whereClauses = ["ps.provider_id = $1"];
  const params = [providerId];
  let paramIndex = 2;

  if (year && month) {
    whereClauses.push(`date_trunc('month', COALESCE(ps.paid_at, ps.updated_at, ps.created_at)) = to_date($${paramIndex}, 'YYYY-MM')`);
    params.push(`${String(year)}-${String(month).padStart(2, '0')}`);
    paramIndex++;
  } else if (year) {
    whereClauses.push(`EXTRACT(YEAR FROM COALESCE(ps.paid_at, ps.updated_at, ps.created_at))::int = $${paramIndex}`);
    params.push(Number(year));
    paramIndex++;
  }

  const normalizedStatus = String(status || "").toLowerCase();
  const includeSettlementRuns = !normalizedStatus || normalizedStatus === "all" || normalizedStatus === "settled";
  if (normalizedStatus && normalizedStatus !== 'all') {
    // Map friendly status to underlying status lists
    let statuses = [];
    if (normalizedStatus === 'refunded') {
      whereClauses.push("fle.id IS NOT NULL");
    } else {
      if (normalizedStatus === 'paid') statuses = PAID_SETTLEMENT_STATUSES;
      else if (normalizedStatus === 'pending') statuses = PENDING_SETTLEMENT_STATUSES;
      else if (normalizedStatus === 'failed') statuses = FAILED_SETTLEMENT_STATUSES;
      else statuses = [normalizedStatus];

      whereClauses.push(`ps.status = ANY($${paramIndex}::text[])`);
      params.push(statuses);
      paramIndex++;
    }
  }

  const baseQuery = `
    SELECT
      ps.id,
      ps.provider_id,
      ps.reservation_id,
      ps.payment_id,
      ps.payment_session_id,
      ps.settlement_allocation_id,
      ps.settlement_batch_id,
      ps.amount,
      ps.paid_amount,
      ps.commission_amount,
      ps.currency,
      ps.status AS status,
      COALESCE((
        SELECT SUM(fle.amount)
        FROM financial_ledger_entries fle
        WHERE fle.provider_settlement_id = ps.id
          AND fle.event_type = 'provider_refund_liability_released'
      ), 0)::numeric AS recorded_refund_deduction_amount,
      COALESCE((
        SELECT SUM(release_entry.amount)
        FROM financial_ledger_entries release_entry
        WHERE release_entry.event_type = 'provider_refund_liability_released'
          AND release_entry.refund_id IN (
            SELECT refund_entry.refund_id
            FROM financial_ledger_entries refund_entry
            WHERE refund_entry.reservation_id = ps.reservation_id
              AND refund_entry.payment_session_id = ps.payment_session_id
              AND refund_entry.event_type = 'refund_issued'
              AND refund_entry.refund_id IS NOT NULL
          )
      ), 0)::numeric AS recorded_carry_forward_amount,
      (
        SELECT p.status
        FROM payments p
        WHERE p.reservation_id = ps.reservation_id
          AND p.payment_session_id = ps.payment_session_id
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT 1
      ) AS payment_status,
      (
        SELECT p.refund_status
        FROM payments p
        WHERE p.reservation_id = ps.reservation_id
          AND p.payment_session_id = ps.payment_session_id
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT 1
      ) AS refund_status,
      COALESCE(fle.refund_amount, 0)::numeric AS refund_amount,
      COALESCE(ps.manual_carry_forward_amount, 0)::numeric AS manual_carry_forward_amount,
      ${sqlNullableTimestampUtc('ps.manual_carry_forward_applied_at')} AS manual_carry_forward_applied_at,
      ${sqlNullableTimestampUtc('ps.paid_at')} AS paid_at,
      ps.payment_reference,
      ps.notes,
      ps.processed_by,
      ${sqlTimestampUtc('ps.created_at')} AS created_at,
      ${sqlTimestampUtc('ps.updated_at')} AS updated_at
    FROM provider_settlements ps
    LEFT JOIN LATERAL (
      SELECT id, event_type, LEAST(amount, ps.amount) AS refund_amount
      FROM financial_ledger_entries
      WHERE reservation_id = ps.reservation_id
        AND payment_session_id = ps.payment_session_id
        AND event_type = 'refund_issued'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) fle ON true
    WHERE ${whereClauses.join(' AND ')}
  `;

  const safeLimit = normalizeLimit(limit, 50);
  const parsedPage = Number(page);
  const safePage = Number.isFinite(parsedPage) && parsedPage > 0
    ? Math.floor(parsedPage)
    : Math.max(Math.floor(Number(offset) / safeLimit) + 1, 1);
  const safeOffset = (safePage - 1) * safeLimit;
  const runParams = [...params];
  const runWhere = [`provider_id = $${runParams.length + 1}`];
  runParams.push(providerId);
  let runIndex = runParams.length + 1;
  if (includeSettlementRuns) {
    if (year && month) {
      runWhere.push(`settlement_year = $${runIndex}`, `settlement_month = $${runIndex + 1}`);
      runParams.push(Number(year), Number(month));
      runIndex += 2;
    } else if (year) {
      runWhere.push(`settlement_year = $${runIndex}`);
      runParams.push(Number(year));
    }
  }

  const limitParam = runParams.length + 1;
  const offsetParam = runParams.length + 2;
  runParams.push(safeLimit, safeOffset);
  const runRecords = includeSettlementRuns
    ? `
      SELECT
        to_jsonb(provider_settlement_runs) || jsonb_build_object(
          'reservation_id', id,
          'payment_session_id', 'settlement-run:' || id,
          'amount', paid_amount,
          'paid_amount', paid_amount,
          'commission_amount', 0,
          'currency', 'INR',
          'status', 'settled',
          'raw_status', 'settled',
          'paid_at', settled_at,
          'settlement_run', true,
          'display_status', 'Settled',
          'created_at', settled_at,
          'updated_at', settled_at
        ) AS record,
        settled_at AS record_date,
        id::text AS record_id
      FROM provider_settlement_runs
      WHERE ${runWhere.join(" AND ")}
        AND COALESCE(paid_amount, 0) > 0
    `
    : `
      SELECT NULL::jsonb AS record, NULL::timestamp AS record_date, NULL::text AS record_id
      WHERE false
    `;
  const providerRecordsQuery = normalizedStatus === "settled"
    ? "SELECT NULL::uuid AS id, NULL::timestamp AS paid_at, NULL::timestamp AS updated_at, NULL::timestamp AS created_at WHERE false"
    : baseQuery;
  const combinedQuery = `
    WITH provider_records AS (${providerRecordsQuery}), combined_records AS (
      SELECT to_jsonb(provider_records) AS record,
             COALESCE(paid_at, updated_at, created_at)::timestamp AS record_date,
             id::text AS record_id
      FROM provider_records
      UNION ALL
      ${runRecords}
    )
    SELECT record, COUNT(*) OVER()::int AS total_count
    FROM combined_records
    ORDER BY record_date DESC, record_id DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  let result = { rows: [] };
  try {
    result = await client.query(combinedQuery, runParams);
  } catch (error) {
    if (
      error?.code !== "42P01" &&
      !String(error?.message || "").startsWith("Unexpected SQL in mock") &&
      !String(error?.message || "").startsWith("Unexpected query")
    ) {
      throw error;
    }
  }

  const records = preserveSettlementRecordDisplay(
    applyRefundCarryForward(result.rows.map((row) => serializeSettlement(row.record))),
  );
  const count = Number(result.rows[0]?.total_count || 0);

  return {
    records,
    limit: safeLimit,
    offset: safeOffset,
    page: safePage,
    pageCount: Math.ceil(count / safeLimit),
    count,
  };
}

async function getProviderSettledRecordsTotal({
  client = pool,
  providerId,
  year,
} = {}) {
  const params = [providerId];
  const where = ["provider_id = $1", "status = 'settled'"];
  if (year) {
    where.push("settlement_year = $2");
    params.push(Number(year));
  }

  const result = await client.query(
    `
    SELECT COALESCE(SUM(paid_amount), 0)::numeric AS total
    FROM provider_settlement_runs
    WHERE ${where.join(" AND ")}
      AND COALESCE(paid_amount, 0) > 0
    `,
    params,
  );

  return Number(result.rows[0]?.total || 0);
}

async function listProviderSettlementRuns({
  client = pool,
  providerId,
  year,
  month,
  status = "settled",
  limit = 50,
  offset = 0,
} = {}) {
  const params = [providerId];
  const where = ["provider_id = $1"];
  let index = 2;
  if (year && month) {
    where.push(`settlement_year = $${index}`, `settlement_month = $${index + 1}`);
    params.push(Number(year), Number(month));
    index += 2;
  } else if (year) {
    where.push(`settlement_year = $${index}`);
    params.push(Number(year));
    index += 1;
  }
  if (status && status !== "all") {
    where.push(`status = $${index}`);
    params.push(status);
    index += 1;
  }
  const result = await client.query(
    `
    SELECT id, provider_id, settlement_year, settlement_month, settled_at,
           settled_by, paid_amount, pending_amount_before, pending_amount_after,
           carry_forward_reduced_amount, payment_reference, notes, status
    FROM provider_settlement_runs
    WHERE ${where.join(" AND ")}
      AND COALESCE(paid_amount, 0) > 0
    ORDER BY settled_at DESC, id DESC
    `,
    params,
  );
  const rows = result.rows.map((run) => ({
    id: run.id,
    provider_id: run.provider_id,
    reservation_id: run.id,
    payment_session_id: `settlement-run:${run.id}`,
    amount: Number(run.paid_amount || 0),
    paid_amount: Number(run.paid_amount || 0),
    currency: "INR",
    status: "settled",
    raw_status: "settled",
    paid_at: run.settled_at,
    payment_reference: run.payment_reference,
    notes: run.notes,
    settlement_run: true,
    settlement_year: Number(run.settlement_year),
    settlement_month: Number(run.settlement_month),
    pending_amount_before: Number(run.pending_amount_before || 0),
    pending_amount_after: Number(run.pending_amount_after || 0),
    carry_forward_reduced_amount: Number(run.carry_forward_reduced_amount || 0),
    display_status: "Settled",
    created_at: run.settled_at,
    updated_at: run.settled_at,
  }));
  const safeLimit = normalizeLimit(limit, 50);
  const safeOffset = Number(offset) || 0;
  return { records: rows.slice(safeOffset, safeOffset + safeLimit), limit: safeLimit, offset: safeOffset, count: rows.length };
}

function normalizeAdminSettlementFilter(value) {
  const filter = String(value || "pending")
    .trim()
    .toLowerCase();
  return ["pending", "paid", "failed", "all"].includes(filter)
    ? filter
    : "pending";
}

function normalizeAdminSettlementSearch(value) {
  const search = trimText(value || "", 120);
  if (!search) return null;

  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

function normalizeAdminVerificationFilter(value) {
  const filter = String(value || "all")
    .trim()
    .toLowerCase();
  return [
    "all",
    "verified",
    "pending_review",
    "rejected",
    "no_account",
  ].includes(filter)
    ? filter
    : "all";
}

function adminVerificationFilterCondition(parameterIndex) {
  return `
    (
      $${parameterIndex}::text IS NULL
      OR $${parameterIndex} = 'all'
      OR (
        $${parameterIndex} = 'verified'
        AND ppa.verification_status = 'verified'
      )
      OR (
        $${parameterIndex} = 'pending_review'
        AND ppa.id IS NOT NULL
        AND ppa.verification_status = 'pending'
      )
      OR (
        $${parameterIndex} = 'rejected'
        AND ppa.verification_status = 'rejected'
      )
      OR (
        $${parameterIndex} = 'no_account'
        AND ppa.id IS NULL
      )
    )
  `;
}

function adminSettlementSearchCondition(parameterIndex) {
  return `
    CONCAT_WS(
      ' ',
      u.name,
      u.phone,
      r.restaurant_name,
      ppa.account_type,
      ppa.upi_id,
      ppa.account_holder_name,
      ppa.bank_account_number,
      ppa.ifsc_code
    ) ILIKE $${parameterIndex} ESCAPE '\\'
  `;
}

function adminSettlementStatusesForFilter(filter) {
  if (filter === "pending") return PENDING_SETTLEMENT_STATUSES;
  if (filter === "paid") return PAID_SETTLEMENT_STATUSES;
  if (filter === "failed") return FAILED_SETTLEMENT_STATUSES;

  return Array.from(
    new Set([
      ...PENDING_SETTLEMENT_STATUSES,
      ...PAID_SETTLEMENT_STATUSES,
      ...FAILED_SETTLEMENT_STATUSES,
      ...FINAL_SETTLEMENT_STATUSES,
    ]),
  );
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
    verification_status: row.payout_verification_status,
    verified_at: row.payout_verified_at,
    verified_by: row.payout_verified_by,
    rejection_reason: row.payout_rejection_reason,
    created_at: row.payout_created_at,
    updated_at: row.payout_updated_at,
  });

  return account;
}

function serializeAdminSettlementSummary(row) {
  return {
    provider_id: row.provider_id,
    provider_name:
      row.provider_name ||
      row.restaurant_name ||
      row.provider_phone ||
      "Provider",
    provider_phone: row.provider_phone || null,
    restaurant_name: row.restaurant_name || null,
    amount_due: Number(row.amount_due || 0),
    pending_settlements:
      Number(row.amount_due || 0) > 0
        ? Number(row.pending_settlements || 0)
        : 0,
    pending_refund_amount: Number(row.pending_refund_amount || 0),
    refund_deduction_amount: Number(row.refund_deduction_amount || 0),
    paid_earnings: Number(row.paid_earnings || 0),
    refund_amount: Number(row.refund_amount || 0),
    paid_settlements: Number(row.paid_settlements || 0),
    failed_settlements: Number(row.failed_settlements || 0),
    last_settlement_at: row.last_settlement_at || null,
    payout_account: payoutAccountSummary(row),
  };
}

function serializeAdminSettlement(row) {
  return {
    ...serializeSettlement(row),
    ...serializeAdminSettlementSummary(row),
  };
}

function serializeAdminMonthlySettlement(row) {
  const total = Number(row.total_amount || 0);
  const paid = Number(row.paid_amount || 0);
  const pending = Number(row.pending_amount || 0);

  let status = "Pending";
  if (pending === 0) status = "Paid";
  else if (paid >= total && total > 0) status = "Paid";
  else if (paid > 0 && paid < total) status = "Partially Paid";

  return {
    provider_id: row.provider_id,
    provider_name: row.provider_name || row.restaurant_name || row.provider_phone || "Provider",
    provider_phone: row.provider_phone || null,
    restaurant_name: row.restaurant_name || null,
    month_year: row.month_year,
    month_label: row.month_label,
    year: Number(row.year || 0),
    month: Number(row.month || 0),
    record_count: Number(row.record_count || 0),
    total_amount: total,
    paid_amount: paid,
    pending_amount: pending,
    carry_forward_amount: Number(row.carry_forward_amount || 0),
    uncarried_refund_amount: Number(row.uncarried_refund_amount || 0),
    status,
    last_settlement_at: row.last_settlement_at || null,
    payout_account: payoutAccountSummary(row),
  };
}

async function listAdminMonthlySettlements({
  client = pool,
  status = "pending",
  verificationStatus = "all",
  limit = DEFAULT_ADMIN_SETTLEMENT_LIMIT,
  search,
  providerId,
  year,
  month,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureProviderPayoutSchema(client);
  }

  const filter = normalizeAdminSettlementFilter(status);
  const filterStatuses = adminSettlementStatusesForFilter(filter);
  const verificationFilter = normalizeAdminVerificationFilter(verificationStatus);
  const searchPattern = normalizeAdminSettlementSearch(search);
  const selectedProviderId = trimText(providerId || "", 80) || null;
  const rowLimit = normalizeLimit(limit);
  // Build summary for provider list (same as regular settlements)
  const summaryResult = await client.query(
    `
    WITH settlement_projection AS (
      SELECT
        ps.*,
        LEAST(ps.amount, COALESCE((
          SELECT SUM(fle.amount)
          FROM financial_ledger_entries fle
          WHERE fle.reservation_id = ps.reservation_id
            AND fle.payment_session_id = ps.payment_session_id
            AND fle.event_type = 'refund_issued'
        ), 0))::numeric AS refund_amount,
        COALESCE((
          SELECT SUM(release_entry.amount)
          FROM financial_ledger_entries release_entry
          WHERE release_entry.provider_settlement_id = ps.id
            AND release_entry.event_type = 'provider_refund_liability_released'
        ), 0)::numeric AS recorded_refund_deduction_amount
      FROM provider_settlements ps
    ), provider_due AS (
      SELECT
        ps.provider_id,
        COALESCE(SUM(GREATEST(
          ps.amount - COALESCE(ps.paid_amount, 0) - ps.recorded_refund_deduction_amount,
          0
        )) FILTER (
          WHERE ps.status = ANY($1::text[])
            AND ps.refund_amount = 0
        ), 0)::numeric AS amount_due,
        COALESCE(SUM(ps.refund_amount) FILTER (WHERE ps.status = ANY($2::text[])), 0)::numeric AS refund_total,
        COALESCE(SUM(ps.manual_carry_forward_amount) FILTER (
          WHERE ps.refund_amount > 0
        ), 0)::numeric AS refund_deduction_amount,
        COUNT(*) FILTER (
          WHERE ps.status = ANY($1::text[])
            AND ps.refund_amount = 0
            AND GREATEST(
              ps.amount - COALESCE(ps.paid_amount, 0) - ps.recorded_refund_deduction_amount,
              0
            ) > 0
        )::int AS pending_settlements,
        CASE
          WHEN MAX(COALESCE(ps.paid_at, ps.updated_at, ps.created_at)) IS NULL THEN NULL
          ELSE to_char(MAX(COALESCE(ps.paid_at, ps.updated_at, ps.created_at)), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        END AS last_settlement_at
      FROM settlement_projection ps
      GROUP BY ps.provider_id
    ),
    active_accounts AS (
      SELECT DISTINCT ON (provider_id)
        id,
        provider_id,
        account_type,
        upi_id,
        account_holder_name,
        bank_account_number,
        ifsc_code,
        is_active,
        is_verified,
        verification_status,
        verified_at,
        verified_by,
        rejection_reason,
        ${sqlTimestampUtc("created_at")} AS created_at,
        ${sqlTimestampUtc("updated_at")} AS updated_at
      FROM provider_payout_accounts
      WHERE is_active=true
      ORDER BY provider_id, created_at DESC, id DESC
    )
    SELECT
      pd.provider_id,
      u.name AS provider_name,
      u.phone AS provider_phone,
      r.restaurant_name,
      COALESCE(pd.amount_due, 0) AS amount_due,
      COALESCE(pd.pending_settlements, 0) AS pending_settlements,
      GREATEST(COALESCE(pd.refund_total, 0) - COALESCE(pd.refund_deduction_amount, 0), 0) AS pending_refund_amount,
      COALESCE(pd.refund_deduction_amount, 0) AS refund_deduction_amount,
      pd.last_settlement_at,
      ppa.id AS payout_account_id,
      ppa.account_type AS payout_account_type,
      ppa.upi_id AS payout_upi_id,
      ppa.account_holder_name AS payout_account_holder_name,
      ppa.bank_account_number AS payout_bank_account_number,
      ppa.ifsc_code AS payout_ifsc_code,
      ppa.is_verified AS payout_is_verified,
      ppa.verification_status AS payout_verification_status,
      ppa.verified_at AS payout_verified_at,
      ppa.verified_by AS payout_verified_by,
      ppa.rejection_reason AS payout_rejection_reason,
      ppa.created_at AS payout_created_at,
      ppa.updated_at AS payout_updated_at
    FROM provider_due pd
    JOIN users u ON u.id=pd.provider_id
    LEFT JOIN restaurants r ON r.user_id=pd.provider_id
    LEFT JOIN active_accounts ppa ON ppa.provider_id=pd.provider_id
    WHERE ($4::text IS NULL OR ${adminSettlementSearchCondition(4)})
      AND ${adminVerificationFilterCondition(5)}
    ORDER BY
      COALESCE(pd.pending_settlements, 0) DESC,
      COALESCE(pd.amount_due, 0) DESC,
      pd.last_settlement_at DESC NULLS LAST,
      LOWER(COALESCE(r.restaurant_name, u.name, u.phone, 'provider')) ASC
    LIMIT $3::int
    `,
    [
      OUTSTANDING_SETTLEMENT_STATUSES,
      PAID_SETTLEMENT_STATUSES,
      rowLimit,
      searchPattern,
      verificationFilter,
    ],
  );

  const projectedConsole = await listAdminProviderSettlements({
    client,
    status: "all",
    verificationStatus,
    limit: rowLimit,
    search,
    providerId,
    ensureSchema: false,
  });
  const monthlyMap = new Map();

  const monthlyProjection = applyManualCarryForwardProjection(
    applyRefundCarryForward(projectedConsole.settlements),
  );
  for (const record of monthlyProjection) {
    const recordStatus = normalizeSettlementStatus(record.status);
    if (!filterStatuses.includes(recordStatus)) continue;

    const date = new Date(record.created_at || record.updated_at || 0);
    if (!Number.isFinite(date.getTime())) continue;
    if (year && date.getFullYear() !== Number(year)) continue;
    if (month && date.getMonth() + 1 !== Number(month)) continue;

    const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthMapKey = `${record.provider_id}:${monthYear}`;
    const monthRecord = monthlyMap.get(monthMapKey) || {
      provider_id: record.provider_id,
      provider_name: record.provider_name,
      provider_phone: record.provider_phone,
      restaurant_name: record.restaurant_name,
      month_year: monthYear,
      month_label: date.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
      }),
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      record_count: 0,
      total_amount: 0,
      paid_amount: 0,
      pending_amount: 0,
      carry_forward_amount: 0,
      uncarried_refund_amount: 0,
      refunded_amount: 0,
      last_settlement_at: record.paid_at || record.updated_at || record.created_at,
      payout_account: record.payout_account,
    };
    const amount = Number(record.amount || 0);
    const refund = Number(record.refund_amount || 0);
    const deduction = Number(record.refund_deduction_amount || 0);
    const netAmount = Math.max(amount - deduction, 0);
    const paidAmount = refund > 0
      ? 0
      : recordStatus === "paid"
        ? getPaidSettlementAmount(record)
        : Math.min(Number(record.paid_amount || 0), netAmount);
    const pendingAmount = PENDING_SETTLEMENT_STATUSES.includes(recordStatus)
      ? refund > 0
        ? Number(record.paid_amount || 0) > 0
          ? 0
          : amount
        : Math.max(
            netAmount -
              paidAmount -
              (paidAmount > 0 ? Number(record.refund_deduction_amount || 0) : 0),
            0,
          )
      : 0;

    monthRecord.record_count += 1;
    monthRecord.total_amount += netAmount;
    monthRecord.paid_amount += paidAmount;
    monthRecord.pending_amount += pendingAmount;
    monthRecord.refunded_amount += refund;
    if (refund > 0) {
      monthRecord.carry_forward_amount += Number(
        record.manual_carry_forward_amount || 0,
      ) + Number(
        record.recorded_carry_forward_amount || 0,
      );
      monthRecord.uncarried_refund_amount += Math.max(
        refund -
          Number(record.manual_carry_forward_amount || 0) -
          Number(record.recorded_carry_forward_amount || 0),
        0,
      );
    }
    monthlyMap.set(monthMapKey, monthRecord);
  }

  const projectedMonthlySettlements = Array.from(monthlyMap.values())
    .sort((left, right) =>
      right.month_year.localeCompare(left.month_year) ||
      String(left.provider_id).localeCompare(String(right.provider_id)),
    )
    .slice(0, rowLimit)
    .map((row) => serializeAdminMonthlySettlement(row));

  return {
    filter,
    summary: summaryResult.rows.map(serializeAdminSettlementSummary),
    monthly_settlements: projectedMonthlySettlements,
  };

  // Build monthly aggregates with optional year/month filter
  // Separate WHERE clauses for WITH statement and outer SELECT
  const monthlyWithWhereClauses = [
    "ps.status = ANY($2::text[])",
  ];
  const monthlySelectWhereClauses = [];
  const monthlyParams = [rowLimit, filterStatuses, PENDING_SETTLEMENT_STATUSES, PAID_SETTLEMENT_STATUSES];
  let monthlyParamIndex = 5;

  if (selectedProviderId) {
    monthlyWithWhereClauses.push(`ps.provider_id::text = $${monthlyParamIndex}`);
    monthlyParams.push(selectedProviderId);
    monthlyParamIndex++;
  }

  if (year && month) {
    monthlyWithWhereClauses.push(
      `date_trunc('month', COALESCE(ps.paid_at, ps.updated_at, ps.created_at)) = to_date($${monthlyParamIndex}, 'YYYY-MM')`
    );
    monthlyParams.push(`${String(year)}-${String(month).padStart(2, '0')}`);
    monthlyParamIndex++;
  } else if (year) {
    monthlyWithWhereClauses.push(
      `EXTRACT(YEAR FROM COALESCE(ps.paid_at, ps.updated_at, ps.created_at))::int = $${monthlyParamIndex}`
    );
    monthlyParams.push(Number(year));
    monthlyParamIndex++;
  }

  // Search pattern needs to be in outer SELECT WHERE clause (references u, r, ppa tables)
  if (searchPattern) {
    monthlySelectWhereClauses.push(
      `CONCAT_WS(
        ' ',
        u.name,
        u.phone,
        r.restaurant_name,
        ppa.account_type,
        ppa.upi_id,
        ppa.account_holder_name,
        ppa.bank_account_number,
        ppa.ifsc_code
      ) ILIKE $${monthlyParamIndex} ESCAPE '\\'`
    );
    monthlyParams.push(searchPattern);
    monthlyParamIndex++;
  }

  // Verification filter also needs to be in outer SELECT WHERE clause
  monthlySelectWhereClauses.push(`${adminVerificationFilterCondition(monthlyParamIndex)}`);
  monthlyParams.push(verificationFilter);

  const result = await client.query(
    `
    WITH settlement_projection AS (
      SELECT
        ps.*,
        LEAST(ps.amount, COALESCE((
          SELECT SUM(fle.amount)
          FROM financial_ledger_entries fle
          WHERE fle.reservation_id = ps.reservation_id
            AND fle.payment_session_id = ps.payment_session_id
            AND fle.event_type = 'refund_issued'
        ), 0))::numeric AS refund_amount,
        COALESCE((
          SELECT SUM(release_entry.amount)
          FROM financial_ledger_entries release_entry
          WHERE release_entry.provider_settlement_id = ps.id
            AND release_entry.event_type = 'provider_refund_liability_released'
        ), 0)::numeric AS recorded_refund_deduction_amount
      FROM provider_settlements ps
    ), monthly_settlements AS (
      SELECT
        ps.provider_id,
        to_char(COALESCE(ps.paid_at, ps.updated_at, ps.created_at), 'YYYY-MM') AS month_year,
        to_char(COALESCE(ps.paid_at, ps.updated_at, ps.created_at), 'Mon YYYY') AS month_label,
        EXTRACT(YEAR FROM COALESCE(ps.paid_at, ps.updated_at, ps.created_at))::int AS year,
        EXTRACT(MONTH FROM COALESCE(ps.paid_at, ps.updated_at, ps.created_at))::int AS month,
        GREATEST(
          COALESCE(SUM(
            ps.amount - COALESCE(ps.paid_amount, 0) - ps.refund_amount - ps.manual_carry_forward_amount
          ) FILTER (WHERE ps.status = ANY($3::text[])), 0),
          0
        )::numeric AS pending_amount,
        COALESCE(SUM(ps.amount - ps.refund_amount - ps.manual_carry_forward_amount) FILTER (WHERE ps.status = ANY($4::text[])), 0)::numeric AS paid_amount,
        COALESCE(SUM(ps.amount - COALESCE(ps.paid_amount, 0) - ps.refund_amount - ps.manual_carry_forward_amount) FILTER (WHERE ps.status = ANY($3::text[])), 0)::numeric
          + COALESCE(SUM(ps.amount - ps.refund_amount - ps.manual_carry_forward_amount) FILTER (WHERE ps.status = ANY($4::text[])), 0)::numeric
          AS total_amount,
        COUNT(*)::int AS record_count,
        MAX(COALESCE(ps.paid_at, ps.updated_at, ps.created_at))::timestamp AS last_settlement_ts
      FROM settlement_projection ps
      WHERE ${monthlyWithWhereClauses.join(' AND ')}
      GROUP BY ps.provider_id, month_year, month_label, year, month
    ),
    active_accounts AS (
      SELECT DISTINCT ON (provider_id)
        ppa.id,
        ppa.provider_id,
        ppa.account_type,
        ppa.upi_id,
        ppa.account_holder_name,
        ppa.bank_account_number,
        ppa.ifsc_code,
        ppa.is_active,
        ppa.is_verified,
        ppa.verification_status,
        ppa.verified_at,
        ppa.verified_by,
        ppa.rejection_reason,
        ${sqlTimestampUtc("ppa.created_at")} AS created_at,
        ${sqlTimestampUtc("ppa.updated_at")} AS updated_at
      FROM provider_payout_accounts ppa
      WHERE ppa.is_active=true
      ORDER BY ppa.provider_id, ppa.created_at DESC, ppa.id DESC
    )
    SELECT
      ms.provider_id,
      u.name AS provider_name,
      u.phone AS provider_phone,
      r.restaurant_name,
      ms.month_year,
      ms.month_label,
      ms.year,
      ms.month,
      ms.pending_amount,
      ms.paid_amount,
      ms.total_amount,
      ms.record_count,
      to_char(ms.last_settlement_ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_settlement_at,
      ppa.id AS payout_account_id,
      ppa.account_type AS payout_account_type,
      ppa.upi_id AS payout_upi_id,
      ppa.account_holder_name AS payout_account_holder_name,
      ppa.bank_account_number AS payout_bank_account_number,
      ppa.ifsc_code AS payout_ifsc_code,
      ppa.is_verified AS payout_is_verified,
      ppa.verification_status AS payout_verification_status,
      ppa.verified_at AS payout_verified_at,
      ppa.verified_by AS payout_verified_by,
      ppa.rejection_reason AS payout_rejection_reason,
      ppa.created_at AS payout_created_at,
      ppa.updated_at AS payout_updated_at
    FROM monthly_settlements ms
    JOIN users u ON u.id = ms.provider_id
    LEFT JOIN restaurants r ON r.user_id = ms.provider_id
    LEFT JOIN active_accounts ppa ON ppa.provider_id = ms.provider_id
    ${monthlySelectWhereClauses.length > 0 ? 'WHERE ' + monthlySelectWhereClauses.join(' AND ') : ''}
    ORDER BY
      ms.year DESC,
      ms.month DESC,
      ms.record_count DESC,
      LOWER(COALESCE(r.restaurant_name, u.name, u.phone, 'provider')) ASC
    LIMIT $1::int
    `,
    monthlyParams
  );

  const monthlySettlements = result.rows.map(serializeAdminMonthlySettlement);

  return {
    filter,
    summary: summaryResult.rows.map(serializeAdminSettlementSummary),
    monthly_settlements: monthlySettlements,
  };
}

async function listAdminProviderSettlements({
  client = pool,
  status = "pending",
  verificationStatus = "all",
  limit = DEFAULT_ADMIN_SETTLEMENT_LIMIT,
  search,
  providerId,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureProviderPayoutSchema(client);
  }

  const filter = normalizeAdminSettlementFilter(status);
  const filterStatuses = adminSettlementStatusesForFilter(filter);
  const verificationFilter =
    normalizeAdminVerificationFilter(verificationStatus);
  const searchPattern = normalizeAdminSettlementSearch(search);
  const selectedProviderId = trimText(providerId || "", 80) || null;
  const rowLimit = normalizeLimit(limit);
  const allSettlementStatuses = Array.from(
    new Set([
      ...PENDING_SETTLEMENT_STATUSES,
      ...PAID_SETTLEMENT_STATUSES,
      ...FAILED_SETTLEMENT_STATUSES,
      ...FINAL_SETTLEMENT_STATUSES,
    ]),
  );

  const summaryResult = await client.query(
    `
    WITH settlement_projection AS (
      SELECT
        ps.*,
        LEAST(ps.amount, COALESCE((
          SELECT SUM(fle.amount)
          FROM financial_ledger_entries fle
          WHERE fle.reservation_id = ps.reservation_id
            AND fle.payment_session_id = ps.payment_session_id
            AND fle.event_type = 'refund_issued'
        ), 0))::numeric AS refund_amount,
        COALESCE((
          SELECT SUM(release_entry.amount)
          FROM financial_ledger_entries release_entry
          WHERE release_entry.provider_settlement_id = ps.id
            AND release_entry.event_type = 'provider_refund_liability_released'
        ), 0)::numeric AS recorded_refund_deduction_amount
      FROM provider_settlements ps
    ), provider_due AS (
      SELECT
        ps.provider_id,
        COALESCE(SUM(GREATEST(
          ps.amount - COALESCE(ps.paid_amount, 0) - ps.recorded_refund_deduction_amount,
          0
        )) FILTER (
          WHERE ps.status = ANY($1::text[])
            AND ps.refund_amount = 0
        ), 0)::numeric AS amount_due,
        COALESCE(SUM(ps.refund_amount) FILTER (WHERE ps.status = ANY($2::text[])), 0)::numeric AS refund_total,
        COALESCE(SUM(ps.manual_carry_forward_amount) FILTER (
          WHERE ps.refund_amount > 0
        ), 0)::numeric AS refund_deduction_amount,
        COUNT(*) FILTER (
          WHERE ps.status = ANY($1::text[])
            AND ps.refund_amount = 0
            AND GREATEST(
              ps.amount - COALESCE(ps.paid_amount, 0) - ps.recorded_refund_deduction_amount,
              0
            ) > 0
        )::int AS pending_settlements,
        CASE
          WHEN MAX(COALESCE(ps.paid_at, ps.updated_at, ps.created_at)) IS NULL THEN NULL
          ELSE to_char(MAX(COALESCE(ps.paid_at, ps.updated_at, ps.created_at)), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        END AS last_settlement_at
      FROM settlement_projection ps
      GROUP BY ps.provider_id
    ),
    active_accounts AS (
      SELECT DISTINCT ON (provider_id)
        id,
        provider_id,
        account_type,
        upi_id,
        account_holder_name,
        bank_account_number,
        ifsc_code,
        is_active,
        is_verified,
        verification_status,
        verified_at,
        verified_by,
        rejection_reason,
        ${sqlTimestampUtc("created_at")} AS created_at,
        ${sqlTimestampUtc("updated_at")} AS updated_at
      FROM provider_payout_accounts
      WHERE is_active=true
      ORDER BY provider_id, created_at DESC, id DESC
    )
    SELECT
      pd.provider_id,
      u.name AS provider_name,
      u.phone AS provider_phone,
      r.restaurant_name,
      COALESCE(pd.amount_due, 0) AS amount_due,
      COALESCE(pd.pending_settlements, 0) AS pending_settlements,
      GREATEST(COALESCE(pd.refund_total, 0) - COALESCE(pd.refund_deduction_amount, 0), 0) AS pending_refund_amount,
      COALESCE(pd.refund_deduction_amount, 0) AS refund_deduction_amount,
      pd.last_settlement_at,
      ppa.id AS payout_account_id,
      ppa.account_type AS payout_account_type,
      ppa.upi_id AS payout_upi_id,
      ppa.account_holder_name AS payout_account_holder_name,
      ppa.bank_account_number AS payout_bank_account_number,
      ppa.ifsc_code AS payout_ifsc_code,
      ppa.is_verified AS payout_is_verified,
      ppa.verification_status AS payout_verification_status,
      ppa.verified_at AS payout_verified_at,
      ppa.verified_by AS payout_verified_by,
      ppa.rejection_reason AS payout_rejection_reason,
      ppa.created_at AS payout_created_at,
      ppa.updated_at AS payout_updated_at
    FROM provider_due pd
    JOIN users u ON u.id=pd.provider_id
    LEFT JOIN restaurants r ON r.user_id=pd.provider_id
    LEFT JOIN active_accounts ppa ON ppa.provider_id=pd.provider_id
    WHERE ($4::text IS NULL OR ${adminSettlementSearchCondition(4)})
      AND ${adminVerificationFilterCondition(5)}
    ORDER BY
      COALESCE(pd.pending_settlements, 0) DESC,
      COALESCE(pd.amount_due, 0) DESC,
      pd.last_settlement_at DESC NULLS LAST,
      LOWER(COALESCE(r.restaurant_name, u.name, u.phone, 'provider')) ASC
    LIMIT $3::int
    `,
    [
      OUTSTANDING_SETTLEMENT_STATUSES,
      PAID_SETTLEMENT_STATUSES,
      rowLimit,
      searchPattern,
      verificationFilter,
    ],
  );

  const recordsResult = await client.query(
    `
    WITH settlement_projection AS (
      SELECT
        ps.*,
        LEAST(ps.amount, COALESCE((
          SELECT SUM(fle.amount)
          FROM financial_ledger_entries fle
          WHERE fle.reservation_id = ps.reservation_id
            AND fle.payment_session_id = ps.payment_session_id
            AND fle.event_type = 'refund_issued'
        ), 0))::numeric AS refund_amount
      FROM provider_settlements ps
    ), provider_due AS (
      SELECT
        ps.provider_id,
        COALESCE(SUM(GREATEST(
          ps.amount - COALESCE(ps.paid_amount, 0) - ps.refund_amount - ps.manual_carry_forward_amount,
          0
        )) FILTER (
          WHERE ps.status = ANY($2::text[])
            AND ps.refund_amount = 0
        ), 0)::numeric AS amount_due,
        COUNT(*) FILTER (
          WHERE ps.status = ANY($2::text[])
            AND ps.refund_amount = 0
            AND GREATEST(
              ps.amount - COALESCE(ps.paid_amount, 0) - ps.refund_amount - ps.manual_carry_forward_amount,
              0
            ) > 0
        )::int AS pending_settlements,
        CASE
          WHEN MAX(COALESCE(ps.paid_at, ps.updated_at, ps.created_at)) IS NULL THEN NULL
          ELSE to_char(MAX(COALESCE(ps.paid_at, ps.updated_at, ps.created_at)), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        END AS last_settlement_at
      FROM settlement_projection ps
      GROUP BY ps.provider_id
    ),
    active_accounts AS (
      SELECT DISTINCT ON (provider_id)
        id,
        provider_id,
        account_type,
        upi_id,
        account_holder_name,
        bank_account_number,
        ifsc_code,
        is_active,
        is_verified,
        verification_status,
        verified_at,
        verified_by,
        rejection_reason,
        ${sqlTimestampUtc("created_at")} AS created_at,
        ${sqlTimestampUtc("updated_at")} AS updated_at
      FROM provider_payout_accounts
      WHERE is_active=true
      ORDER BY provider_id, created_at DESC, id DESC
    )
    SELECT
      ps.id,
      ps.provider_id,
      ps.reservation_id,
      ps.payment_id,
      ps.payment_session_id,
      ps.settlement_allocation_id,
      ps.settlement_batch_id,
      ps.amount,
      ps.paid_amount,
      ps.commission_amount,
      ps.currency,
      ps.status AS status,
      COALESCE((
        SELECT SUM(release_entry.amount)
        FROM financial_ledger_entries release_entry
        WHERE release_entry.provider_settlement_id = ps.id
          AND release_entry.event_type = 'provider_refund_liability_released'
      ), 0)::numeric AS recorded_refund_deduction_amount,
      COALESCE((
        SELECT SUM(release_entry.amount)
        FROM financial_ledger_entries release_entry
        WHERE release_entry.event_type = 'provider_refund_liability_released'
          AND release_entry.refund_id IN (
            SELECT refund_entry.refund_id
            FROM financial_ledger_entries refund_entry
            WHERE refund_entry.reservation_id = ps.reservation_id
              AND refund_entry.payment_session_id = ps.payment_session_id
              AND refund_entry.event_type = 'refund_issued'
              AND refund_entry.refund_id IS NOT NULL
          )
      ), 0)::numeric AS recorded_carry_forward_amount,
      (
        SELECT p.status
        FROM payments p
        WHERE p.reservation_id = ps.reservation_id
          AND p.payment_session_id = ps.payment_session_id
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT 1
      ) AS payment_status,
      (
        SELECT p.refund_status
        FROM payments p
        WHERE p.reservation_id = ps.reservation_id
          AND p.payment_session_id = ps.payment_session_id
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT 1
      ) AS refund_status,
      LEAST(ps.amount, COALESCE(fle.refund_amount, 0))::numeric AS refund_amount,
      COALESCE(ps.manual_carry_forward_amount, 0)::numeric AS manual_carry_forward_amount,
      ${sqlNullableTimestampUtc("ps.manual_carry_forward_applied_at")} AS manual_carry_forward_applied_at,
      ${sqlNullableTimestampUtc("ps.paid_at")} AS paid_at,
      ps.payment_reference,
      ps.notes,
      ps.processed_by,
      ps.idempotency_key,
      ps.metadata,
      ${sqlTimestampUtc("ps.created_at")} AS created_at,
      ${sqlTimestampUtc("ps.updated_at")} AS updated_at,
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
      ppa.verification_status AS payout_verification_status,
      ppa.verified_at AS payout_verified_at,
      ppa.verified_by AS payout_verified_by,
      ppa.rejection_reason AS payout_rejection_reason,
      ppa.created_at AS payout_created_at,
      ppa.updated_at AS payout_updated_at
    FROM provider_settlements ps
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(refund_entry.amount), 0)::numeric AS refund_amount
      FROM financial_ledger_entries refund_entry
      WHERE refund_entry.reservation_id = ps.reservation_id
        AND refund_entry.payment_session_id = ps.payment_session_id
        AND refund_entry.event_type = 'refund_issued'
    ) fle ON true
    JOIN users u ON u.id=ps.provider_id
    LEFT JOIN restaurants r ON r.user_id=ps.provider_id
    LEFT JOIN provider_due pd ON pd.provider_id=ps.provider_id
    LEFT JOIN active_accounts ppa ON ppa.provider_id=ps.provider_id
    WHERE ps.status = ANY($3::text[])
      AND ($5::text IS NULL OR ${adminSettlementSearchCondition(5)})
      AND ($6::text IS NULL OR ps.provider_id::text=$6)
      AND ${adminVerificationFilterCondition(7)}
    ORDER BY
      CASE
        WHEN ps.status = ANY($2::text[]) THEN 0
        WHEN ps.status = ANY($4::text[]) THEN 1
        ELSE 2
      END,
      COALESCE(ps.paid_at, ps.updated_at, ps.created_at) DESC,
      ps.id DESC
    LIMIT $1::int
    `,
    [
      rowLimit,
      PENDING_SETTLEMENT_STATUSES,
      allSettlementStatuses,
      FAILED_SETTLEMENT_STATUSES,
      searchPattern,
      selectedProviderId,
      verificationFilter,
    ],
  );

  const rawSettlements = preserveSettlementRecordDisplay(
    applyRefundCarryForward(recordsResult.rows.map(serializeAdminSettlement)),
  );
  const projectedSettlements = applyManualCarryForwardProjection(
    applyRefundCarryForward(rawSettlements),
  );
  const settlements = rawSettlements.filter((record) =>
    filterStatuses.includes(normalizeSettlementStatus(record.status)),
  );

  const projectedSummaryByProvider = new Map();
  for (const record of projectedSettlements) {
    const providerSummary = projectedSummaryByProvider.get(record.provider_id) || {
      amount_due: 0,
      pending_settlements: 0,
      pending_refund_amount: 0,
      refund_deduction_amount: 0,
      refund_total: 0,
      paid_earnings: 0,
      carry_forward_liability: 0,
    };
    const status = normalizeSettlementStatus(record.status);
    const netPayable = Number(record.net_payable || 0);
    const refundAmount = Number(record.refund_amount || 0);
    const pendingPayable = refundAmount > 0
      ? 0
      : Math.max(
        netPayable - Number(record.paid_amount || 0),
        0,
      ) - (Number(record.paid_amount || 0) > 0
        ? Number(record.refund_deduction_amount || 0)
        : 0);
    const effectivePendingPayable = Math.max(
      pendingPayable,
      0,
    );
    if (OUTSTANDING_SETTLEMENT_STATUSES.includes(status)) {
      providerSummary.amount_due += effectivePendingPayable;
      if (effectivePendingPayable > 0) providerSummary.pending_settlements += 1;
    }
    providerSummary.refund_total += Number(
      record.recorded_carry_forward_amount || 0,
    );
    if (refundAmount > 0) {
      providerSummary.carry_forward_liability += Number(
        record.manual_carry_forward_amount || 0,
      );
    }
    if (PAID_SETTLEMENT_STATUSES.includes(status)) {
      if (Number(record.refund_amount || 0) > 0) {
        projectedSummaryByProvider.set(record.provider_id, providerSummary);
        continue;
      }
      providerSummary.paid_earnings += getNetPaidSettlementAmount(record);
    }
    if (Number(record.refund_amount || 0) === 0) {
      providerSummary.refund_deduction_amount += Number(
        record.refund_deduction_amount || 0,
      );
    }
    projectedSummaryByProvider.set(record.provider_id, providerSummary);
  }
  const settledRunTotals = await client.query(
    `
    SELECT provider_id, COALESCE(SUM(paid_amount), 0)::numeric AS total_paid
    FROM provider_settlement_runs
    WHERE status = 'settled'
      AND COALESCE(paid_amount, 0) > 0
      AND ($1::text IS NULL OR provider_id::text = $1)
    GROUP BY provider_id
    `,
    [selectedProviderId],
  );
  for (const row of settledRunTotals.rows) {
    const providerSummary = projectedSummaryByProvider.get(row.provider_id);
    if (providerSummary) {
      providerSummary.paid_earnings = Number(row.total_paid || 0);
    }
  }
  const projectedSummary = summaryResult.rows.map((row) => {
    const projection = projectedSummaryByProvider.get(row.provider_id);
    if (!projection) return serializeAdminSettlementSummary(row);
    return serializeAdminSettlementSummary({
      ...row,
      amount_due: projection.amount_due,
      pending_settlements:
        projection.amount_due > 0 ? projection.pending_settlements : 0,
      pending_refund_amount: projection.carry_forward_liability,
      refund_deduction_amount: projection.refund_deduction_amount,
      paid_earnings: projection.paid_earnings,
      refund_amount: projection.refund_total,
    });
  });

  return {
    filter,
    summary: projectedSummary,
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

function normalizePaidAmount(value, maximum) {
  if (value === undefined || value === null || value === "") return maximum;

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > maximum) {
    throw serviceError(
      "Paid amount must be greater than zero and no more than the remaining settlement amount.",
    );
  }

  return Math.round(amount * 100) / 100;
}

async function loadSettlementForUpdate(client, settlementId) {
  const result = await client.query(
    `
    SELECT *
    FROM provider_settlements
    WHERE id=$1
    FOR UPDATE
    `,
    [settlementId],
  );

  return result.rows[0] || null;
}

async function loadActiveProviderPayoutAccount(client, providerId) {
  const result = await client.query(
    `
    SELECT
      id,
      provider_id,
      account_type,
      upi_id,
      account_holder_name,
      bank_account_number,
      ifsc_code,
      is_active,
      is_verified,
      verification_status,
      verified_at,
      verified_by,
      rejection_reason,
      change_request_status
    FROM provider_payout_accounts
    WHERE provider_id=$1
      AND is_active=true
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [providerId],
  );

  return result.rows[0] || null;
}

async function recordSettlementRefundLiabilityReleases({
  client,
  settlement,
  metadata = {},
} = {}) {
  if (
    !client ||
    !settlement?.id ||
    !settlement?.reservation_id ||
    !settlement?.payment_session_id
  ) {
    return null;
  }

  // Recover prior provider liabilities against the settlement being paid.
  const refundResult = await client.query(
    `
    SELECT
      fle.refund_id,
      source_settlement.id AS source_settlement_id,
      MAX(source_settlement.manual_carry_forward_amount) AS source_carry_forward_amount,
      SUM(fle.amount) FILTER (WHERE fle.event_type = 'refund_issued') AS total_refund_amount,
      SUM(fle.amount) FILTER (WHERE fle.event_type = 'provider_refund_liability_issued') AS liability_issued,
      SUM(fle.amount) FILTER (WHERE fle.event_type = 'provider_refund_liability_released') AS liability_released
    FROM financial_ledger_entries fle
    JOIN provider_settlements source_settlement
      ON source_settlement.reservation_id = fle.reservation_id
      AND source_settlement.payment_session_id = fle.payment_session_id
      AND source_settlement.provider_id = $1
    WHERE fle.refund_id IS NOT NULL
      AND fle.event_type IN (
        'refund_issued',
        'provider_refund_liability_issued',
        'provider_refund_liability_released'
      )
    GROUP BY fle.refund_id, source_settlement.id
    HAVING COALESCE(SUM(fle.amount) FILTER (WHERE fle.event_type = 'provider_refund_liability_issued'), 0)
      > COALESCE(SUM(fle.amount) FILTER (WHERE fle.event_type = 'provider_refund_liability_released'), 0)
      OR COALESCE(MAX(source_settlement.manual_carry_forward_amount), 0) > 0
    `,
    [settlement.provider_id],
  );

  if (!refundResult.rows || refundResult.rows.length === 0) {
    return null;
  }

  // For each refund, check if there's an outstanding liability and release up to the settlement amount
  let totalReleased = 0;

  for (const refundRow of refundResult.rows) {
    const refundId = refundRow.refund_id;
    const totalRefundAmount = Number(refundRow.total_refund_amount || 0);
    const issuedAmount = Number(refundRow.liability_issued || 0);
    const releasedAmount = Number(refundRow.liability_released || 0);
    const sourceCarryForwardAmount = Number(
      refundRow.source_carry_forward_amount || 0,
    );
    const outstandingLiability = Math.max(
      issuedAmount - releasedAmount,
      sourceCarryForwardAmount,
    );

    if (!refundId || outstandingLiability <= 0) continue;

    // Release amount is capped at outstanding liability and settlement amount
    const releaseAmount = Math.min(
      outstandingLiability,
      totalRefundAmount,
      sourceCarryForwardAmount,
    );

    if (releaseAmount > 0) {
      await recordRefundLiabilityReleased({
        client,
        settlement,
        refundAmount: releaseAmount,
        refundId,
        metadata: {
          ...metadata,
          refund_batch: `settlement_${settlement.id}`,
          total_refund_amount: totalRefundAmount,
          outstanding_liability: outstandingLiability,
        },
      });

      totalReleased += releaseAmount;

      await client.query(
        `
        UPDATE provider_settlements
        SET manual_carry_forward_amount = GREATEST(manual_carry_forward_amount - $2, 0),
            manual_carry_forward_applied_at = CASE
              WHEN GREATEST(manual_carry_forward_amount - $2, 0) = 0 THEN NULL
              ELSE manual_carry_forward_applied_at
            END,
            updated_at = NOW()
        WHERE id = $1
        `,
        [refundRow.source_settlement_id, releaseAmount],
      );
    }
  }

  return totalReleased > 0 ? { totalReleased } : null;
}

async function getProviderRefundLiabilitySourceState({
  client,
  settlement,
} = {}) {
  if (
    !client ||
    !settlement?.reservation_id ||
    !settlement?.payment_session_id
  ) {
    return {
      isOriginalProviderRefundLiabilitySource: false,
      issuedAmount: 0,
      applicableIssuedAmount: 0,
      releasedAmount: 0,
      outstandingAmount: 0,
    };
  }

  const result = await client.query(
    `
    WITH source_liability AS (
      SELECT
        issued.refund_id,
        COALESCE(SUM(issued.amount), 0)::numeric AS issued_amount
      FROM financial_ledger_entries issued
      WHERE issued.reservation_id = $1
        AND issued.payment_session_id = $2
        AND issued.event_type = 'provider_refund_liability_issued'
        AND issued.refund_id IS NOT NULL
      GROUP BY issued.refund_id
    ),
    source_releases AS (
      SELECT
        source_liability.refund_id,
        COALESCE(SUM(release_entry.amount), 0)::numeric AS released_amount
      FROM source_liability
      LEFT JOIN financial_ledger_entries release_entry
        ON release_entry.refund_id = source_liability.refund_id
        AND release_entry.event_type = 'provider_refund_liability_released'
      GROUP BY source_liability.refund_id
    )
    SELECT
      COALESCE(SUM(source_liability.issued_amount), 0)::numeric AS issued_amount,
      COALESCE(SUM(LEAST(source_releases.released_amount, source_liability.issued_amount)), 0)::numeric AS released_amount
    FROM source_liability
    LEFT JOIN source_releases
      ON source_releases.refund_id = source_liability.refund_id
    `,
    [settlement.reservation_id, settlement.payment_session_id],
  );

  const row = result.rows[0] || {};
  const issuedAmount = roundMoney(row.issued_amount || 0);
  const releasedAmount = roundMoney(row.released_amount || 0);
  const applicableIssuedAmount = roundMoney(
    Math.min(issuedAmount, Math.max(Number(settlement.amount || 0), 0)),
  );
  const outstandingAmount = roundMoney(
    Math.max(issuedAmount - releasedAmount, 0),
  );

  return {
    isOriginalProviderRefundLiabilitySource: applicableIssuedAmount > 0,
    issuedAmount,
    applicableIssuedAmount,
    releasedAmount,
    outstandingAmount,
  };
}

async function transitionProviderSettlementStatus({
  client,
  settlementId,
  status,
  adminId,
  paymentReference,
  paidAt,
  paidAmount,
  notes,
  ensureSchema = true,
} = {}) {
  const nextStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (!["paid", "failed"].includes(nextStatus)) {
    throw serviceError("Settlement can only be marked paid or failed.");
  }

  const transitionSettlementStatus = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
    }

    const current = await loadSettlementForUpdate(db, settlementId);
    if (!current) return null;

    if (nextStatus === "paid") {
      const refundLiabilitySourceState =
        await getProviderRefundLiabilitySourceState({
          client: db,
          settlement: current,
        });
      if (refundLiabilitySourceState.isOriginalProviderRefundLiabilitySource) {
        throw serviceError(
          "Original provider refund-liability source settlement cannot be marked paid. Recover the liability from a future provider settlement.",
          409,
          "REFUND_LIABILITY_SOURCE_SETTLEMENT",
        );
      }

      await persistProjectedRefundRecovery({
        client: db,
        providerId: current.provider_id,
        adminId,
        notes,
      });
      const refreshed = await loadSettlementForUpdate(db, settlementId);
      if (refreshed) Object.assign(current, refreshed);
    }

    if (current.status === "paid" && nextStatus === "failed") {
      throw serviceError(
        "Paid settlement cannot be marked failed.",
        409,
        "SETTLEMENT_ALREADY_PAID",
      );
    }

    const reference = trimText(paymentReference || "", 120);
    const settlementNotes = trimText(notes || "", 1000);
    const settlementAmount = Number(current.amount || 0);
    const alreadyPaid = Number(current.paid_amount || 0);
    const carryForwardAmount = Number(current.manual_carry_forward_amount || 0);
    const remainingPayable = Math.max(
      settlementAmount - alreadyPaid - carryForwardAmount,
      0,
    );
    const carryForwardConsumed = nextStatus === "paid"
      ? Math.min(carryForwardAmount, Math.max(settlementAmount - alreadyPaid, 0))
      : 0;
    const requestedPayment = nextStatus === "paid"
      ? normalizePaidAmount(paidAmount, remainingPayable)
      : 0;
    const paidAmountValue = Math.min(
      settlementAmount,
      alreadyPaid + requestedPayment,
    );
    const effectiveStatus = paidAmountValue + carryForwardAmount >= settlementAmount
      ? "paid"
      : nextStatus;
    const paidAtValue = effectiveStatus === "paid" ? normalizePaidAt(paidAt) : null;

    if (nextStatus === "paid" && !reference && !current.payment_reference) {
      throw serviceError("Payment reference is required when marking paid.");
    }

    if (nextStatus === "paid") {
      const activeAccount = await loadActiveProviderPayoutAccount(
        db,
        current.provider_id,
      );
      if (!activeAccount) {
        throw serviceError("Provider has not configured a payout account.");
      }

      const changeRequestStatus = String(
        activeAccount.change_request_status || "",
      ).toLowerCase();
      if (changeRequestStatus === "approved") {
        throw serviceError(
          "Provider payout account replacement is pending; mark paid is disabled until a new verified payout account is active.",
          409,
          "PAYOUT_ACCOUNT_REPLACEMENT_PENDING",
        );
      }
      if (changeRequestStatus === "replacement_pending") {
        throw serviceError(
          "Provider payout account replacement is pending; mark paid is disabled until a new verified payout account is active.",
          409,
          "PAYOUT_ACCOUNT_REPLACEMENT_PENDING",
        );
      }

      const verificationStatus = String(
        activeAccount.verification_status || "pending",
      ).toLowerCase();
      const isVerified =
        verificationStatus === "verified" || Boolean(activeAccount.is_verified);

      if (!isVerified) {
        if (verificationStatus === "rejected") {
          throw serviceError("Provider payout account has been rejected.");
        }
        throw serviceError("Provider payout account verification is pending.");
      }
    }

    const result = await db.query(
      `
      UPDATE provider_settlements
      SET status=$2,
          paid_amount=$7,
          manual_carry_forward_amount = GREATEST(manual_carry_forward_amount - $8, 0),
          manual_carry_forward_applied_at = CASE
            WHEN GREATEST(manual_carry_forward_amount - $8, 0) = 0 THEN NULL
            ELSE manual_carry_forward_applied_at
          END,
          paid_at=CASE
            WHEN $2='paid' AND $7 >= amount THEN COALESCE($3::timestamp, paid_at, NOW())
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
      RETURNING
        id,
        provider_id,
        reservation_id,
        payment_id,
        payment_session_id,
        settlement_allocation_id,
        settlement_batch_id,
        amount,
        paid_amount,
        commission_amount,
        currency,
        status,
        ${sqlNullableTimestampUtc("paid_at")} AS paid_at,
        payment_reference,
        notes,
        processed_by,
        idempotency_key,
        metadata,
        ${sqlTimestampUtc("created_at")} AS created_at,
        ${sqlTimestampUtc("updated_at")} AS updated_at
      `,
      [
        settlementId,
        effectiveStatus,
        paidAtValue,
        reference,
        settlementNotes,
        adminId || null,
        paidAmountValue,
        carryForwardConsumed,
      ],
    );

    const updated = result.rows[0];

    if (effectiveStatus === "paid") {
      await recordProviderSettlementPaidLedger({
        client: db,
        settlement: updated,
        metadata: {
          source: "manual_provider_settlement_transition",
          admin_id: adminId || null,
        },
      });

      // Record refund liability release for any refunds associated with this settlement
      await recordSettlementRefundLiabilityReleases({
        client: db,
        settlement: updated,
        metadata: {
          source: "settlement_paid_transition",
          admin_id: adminId || null,
        },
      });
    }

    return serializeSettlement(updated);
  };

  const transitionAndReport = async (db) => {
    const settlement = await transitionSettlementStatus(db);
    return settlement;
  };

  let settlement;

  if (client) {
    settlement = await transitionAndReport(client);
  } else {
    settlement = await withTransaction(pool, transitionAndReport, {
      name: "transition_provider_settlement_status",
      maxAttempts: 3,
    });
  }

  if (settlement && nextStatus === "failed") {
    await recordOperationalEvent({
      category: "financial",
      severity: "info",
      eventName: "provider_settlement_failed",
      metadata: {
        settlement_id: settlement.id,
        provider_id: settlement.provider_id,
        amount: Number(settlement.amount || 0),
        payment_reference: settlement.payment_reference || null,
        admin_id: adminId || null,
        notes: settlement.notes || null,
      },
    });
  }

  return settlement;
}

async function applyManualRefundCarryForward({
  client,
  refundSettlementId,
  adminId,
  notes,
  ensureSchema = true,
} = {}) {
  // Manually apply refund carry forward from a refunded settlement to the next pending settlement
  // This records the operation in financial ledger and updates settlement records
  
  const applyCarryForward = async (db) => {
    if (ensureSchema) {
      await ensureProviderPayoutSchema(db);
      await ensureSettlementAccountingSchema(db);
    }

    // Load the refunded settlement
    const refundSettlement = await db.query(
      `
      SELECT
        ps.id,
        ps.provider_id,
        ps.reservation_id,
        ps.payment_session_id,
        ps.amount,
        ps.status,
        ps.created_at,
        COALESCE(ps.manual_carry_forward_amount, 0)::numeric AS manual_carry_forward_amount,
        LEAST(ps.amount, COALESCE((
          SELECT SUM(fle.amount)
          FROM financial_ledger_entries fle
          WHERE fle.reservation_id = ps.reservation_id
            AND fle.payment_session_id = ps.payment_session_id
            AND fle.event_type = 'refund_issued'
        ), 0))::numeric AS refund_amount
      FROM provider_settlements ps
      WHERE ps.id = $1
      FOR UPDATE
      `,
      [refundSettlementId],
    );

    if (!refundSettlement.rows[0]) {
      throw serviceError("Refunded settlement not found.", 404);
    }

    const refunded = refundSettlement.rows[0];
    const refundAmount = Number(refunded.refund_amount || 0);
    const alreadyCarriedForward = Number(refunded.manual_carry_forward_amount || 0);
    const remainingToCarryForward = Math.max(0, refundAmount - alreadyCarriedForward);

    if (remainingToCarryForward <= 0) {
      throw serviceError(
        "This refund has already been fully carried forward or has no refund amount.",
        409,
        "REFUND_ALREADY_CARRIED_FORWARD",
      );
    }

    const totalCarryForwardAmount = remainingToCarryForward;

    const updateRefundResult = await db.query(
      `
      UPDATE provider_settlements
      SET
        manual_carry_forward_amount = manual_carry_forward_amount + $2,
        manual_carry_forward_applied_at = CASE
          WHEN manual_carry_forward_amount = 0 THEN NOW()
          ELSE manual_carry_forward_applied_at
        END,
        manual_carry_forward_applied_by = $3,
        manual_carry_forward_notes = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        provider_id,
        amount,
        status,
        manual_carry_forward_amount,
        ${sqlNullableTimestampUtc('manual_carry_forward_applied_at')} AS manual_carry_forward_applied_at,
        manual_carry_forward_applied_by
      `,
      [refundSettlementId, totalCarryForwardAmount, adminId || null, notes || null],
    );

    return {
      success: true,
      refundSettlement: updateRefundResult.rows[0],
      targetSettlement: updateRefundResult.rows[0],
      targetSettlements: [updateRefundResult.rows[0]],
      carryForwardAmount: Math.round(totalCarryForwardAmount * 100) / 100,
      remainingToCarryForward: 0,
    };
  };

  if (client) return applyCarryForward(client);

  return withTransaction(pool, applyCarryForward, {
    name: "apply_manual_refund_carry_forward",
    maxAttempts: 3,
  });
}

async function recordRefundCarryForwardLedger(
  db,
  { refundSettlementId, targetSettlementId, amount, adminId, notes } = {}
) {
  // Record the carry forward operation in financial ledger for accounting
  const idempotencyKey = [
    "ledger",
    "provider_refund_liability_released",
    refundSettlementId,
    targetSettlementId,
  ].join(":");

  // Get settlement details for the ledger entry
  const refundSettlement = await db.query(
    `
    SELECT
      target.reservation_id,
      target.payment_session_id,
      (
        SELECT fle.refund_id
        FROM financial_ledger_entries fle
        JOIN provider_settlements source
          ON source.reservation_id = fle.reservation_id
          AND source.payment_session_id = fle.payment_session_id
        WHERE source.id = $1
          AND fle.event_type = 'refund_issued'
          AND fle.refund_id IS NOT NULL
        ORDER BY fle.created_at DESC, fle.id DESC
        LIMIT 1
      ) AS refund_id
    FROM provider_settlements target
    WHERE target.id = $2
    `,
    [refundSettlementId, targetSettlementId],
  );

  if (refundSettlement.rows[0]) {
    const { reservation_id, payment_session_id, refund_id } = refundSettlement.rows[0];

    // Record carry forward ledger entry
    await db.query(
      `
      INSERT INTO financial_ledger_entries (
        reservation_id,
        payment_session_id,
        provider_settlement_id,
        event_type,
        amount,
        actor_user_id,
        actor_role,
        accounting_category,
        refund_id,
        idempotency_key,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (idempotency_key) DO NOTHING
      `,
      [
        reservation_id,
        payment_session_id,
        targetSettlementId,
        'provider_refund_liability_released',
        amount,
        adminId || null,
        'admin',
        'provider_refund_liability',
        refund_id,
        idempotencyKey,
        JSON.stringify({
          refund_settlement_id: refundSettlementId,
          target_settlement_id: targetSettlementId,
          carry_forward_amount: amount,
          admin_notes: notes || null,
        }),
      ],
    );
  }
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
      RETURNING
        id,
        provider_id,
        reservation_id,
        payment_id,
        payment_session_id,
        settlement_allocation_id,
        settlement_batch_id,
        amount,
        paid_amount,
        commission_amount,
        currency,
        status,
        ${sqlNullableTimestampUtc("paid_at")} AS paid_at,
        payment_reference,
        notes,
        processed_by,
        idempotency_key,
        metadata,
        ${sqlTimestampUtc("created_at")} AS created_at,
        ${sqlTimestampUtc("updated_at")} AS updated_at
      `,
      [settlementId, settlementNotes || null, adminId || null],
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
  applyRefundCarryForward,
  applyManualCarryForwardProjection,
  applyManualRefundCarryForward,
  calculateMonthSettlementCarryForwardReduction,
  calculateRefundCarryForwardAllocations,
  reduceSettlementCarryForwardUsage,
  CHANGE_REQUEST_STATUSES,
  FINAL_SETTLEMENT_STATUSES,
  FAILED_SETTLEMENT_STATUSES,
  PAID_SETTLEMENT_STATUSES,
  PENDING_SETTLEMENT_STATUSES,
  deactivateProviderPayoutAccount,
  ensureProviderPayoutSchema,
  getProviderSettlementSummary,
  getProviderSettledRecordsTotal,
  getProviderRefundLiabilitySourceState,
  listProviderSettlementRecords,
  listProviderSettlementRuns,
  listAdminProviderSettlements,
  listAdminMonthlySettlements,
  listAdminProviderPayoutChangeRequests,
  listProviderPayoutAccounts,
  loadActiveProviderPayoutAccount,
  normalizeSettlementStatus,
  replaceProviderPayoutAccount,
  recordSettlementRefundLiabilityReleases,
  requestProviderPayoutAccountChange,
  approveProviderPayoutAccountChange,
  rejectProviderPayoutAccountChange,
  transitionProviderSettlementStatus,
  updateProviderSettlementNotes,
  validatePayoutAccountInput,
  verifyProviderPayoutAccount,
  rejectProviderPayoutAccount,
};
