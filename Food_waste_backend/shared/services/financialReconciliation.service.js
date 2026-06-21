const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");
const logger = require("../utils/logger");
const { withTransaction } = require("../utils/transaction");
const {
  ensureSettlementAccountingSchema,
  recordSettlementAllocation,
} = require("./financialLedger.service");
const {
  createFinancialOwnershipSnapshot,
  getFinancialOwnership,
  roundMoney,
} = require("./financialOwnership.service");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");

const DEFAULT_RECONCILIATION_LIMIT = Number(
  process.env.FINANCIAL_RECONCILIATION_LIMIT || 50
);
let schemaReady;

function positiveLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 500)
    : DEFAULT_RECONCILIATION_LIMIT;
}

function paidPaymentMissingArtifactsPredicate(paymentAlias = "p") {
  const paymentRef = `${paymentAlias}.reservation_id`;
  const sessionRef = `${paymentAlias}.payment_session_id`;

  return `
    ${paymentAlias}.status='paid'
    AND ${paymentRef} IS NOT NULL
    AND ${sessionRef} IS NOT NULL
    AND (
      NOT EXISTS (
        SELECT 1
        FROM payment_ownership po
        WHERE po.reservation_id=${paymentRef}
        AND po.payment_session_id=${sessionRef}
      )
      OR NOT EXISTS (
        SELECT 1
        FROM settlement_allocation_snapshots sas
        WHERE sas.reservation_id=${paymentRef}
        AND sas.payment_session_id=${sessionRef}
      )
      OR EXISTS (
        SELECT 1
        FROM settlement_allocation_snapshots sas
        WHERE sas.reservation_id=${paymentRef}
        AND sas.payment_session_id=${sessionRef}
        AND NOT EXISTS (
          SELECT 1
          FROM financial_ledger_entries fle
          WHERE fle.settlement_allocation_id=sas.id
          AND fle.event_type='payment_collected'
        )
      )
      OR EXISTS (
        SELECT 1
        FROM settlement_allocation_snapshots sas
        WHERE sas.reservation_id=${paymentRef}
        AND sas.payment_session_id=${sessionRef}
        AND sas.food_amount > 0
        AND NOT EXISTS (
          SELECT 1
          FROM financial_ledger_entries fle
          WHERE fle.settlement_allocation_id=sas.id
          AND fle.event_type='food_payment_settled'
        )
      )
      OR EXISTS (
        SELECT 1
        FROM settlement_allocation_snapshots sas
        WHERE sas.reservation_id=${paymentRef}
        AND sas.payment_session_id=${sessionRef}
        AND sas.commission_amount > 0
        AND NOT EXISTS (
          SELECT 1
          FROM financial_ledger_entries fle
          WHERE fle.settlement_allocation_id=sas.id
          AND fle.event_type='platform_commission'
        )
      )
      OR EXISTS (
        SELECT 1
        FROM settlement_allocation_snapshots sas
        WHERE sas.reservation_id=${paymentRef}
        AND sas.payment_session_id=${sessionRef}
        AND sas.deposit_amount > 0
        AND NOT EXISTS (
          SELECT 1
          FROM financial_ledger_entries fle
          WHERE fle.settlement_allocation_id=sas.id
          AND fle.event_type='deposit_collected'
        )
      )
      OR EXISTS (
        SELECT 1
        FROM settlement_allocation_snapshots sas
        WHERE sas.reservation_id=${paymentRef}
        AND sas.payment_session_id=${sessionRef}
        AND sas.provider_amount > 0
        AND NOT EXISTS (
          SELECT 1
          FROM provider_settlements ps
          WHERE ps.settlement_allocation_id=sas.id
        )
      )
      OR EXISTS (
        SELECT 1
        FROM provider_settlements ps
        WHERE ps.reservation_id=${paymentRef}
        AND ps.payment_session_id=${sessionRef}
        AND NOT EXISTS (
          SELECT 1
          FROM financial_ledger_entries fle
          WHERE fle.provider_settlement_id=ps.id
          AND fle.event_type='settlement_allocated'
        )
      )
    )
  `;
}

async function ensureFinancialReconciliationSchema(client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) {
    schemaReady = schemaReady || Promise.resolve();
    return schemaReady;
  }

  const db = client || pool;
  if (db === pool && schemaReady) return schemaReady;

  const run = async () => {
    await ensureSettlementAccountingSchema(db);
    await db.query(`
      ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(6,3) NULL,
      ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS provider_amount NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS food_amount_snapshot NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS platform_amount NUMERIC(12,2) NULL
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_paid_financial_reconciliation
      ON payments (status, updated_at DESC, id)
      WHERE status='paid'
    `);
  };

  if (db === pool) {
    schemaReady = run();
    return schemaReady;
  }

  return run();
}

async function findPaidPaymentsMissingFinancialArtifacts({
  client = pool,
  limit = DEFAULT_RECONCILIATION_LIMIT,
  ensureSchema = true,
} = {}) {
  if (ensureSchema) {
    await ensureFinancialReconciliationSchema(client);
  }

  const result = await client.query(
    `
    SELECT p.*
    FROM payments p
    WHERE ${paidPaymentMissingArtifactsPredicate("p")}
    ORDER BY COALESCE(p.updated_at, p.created_at) ASC, p.id ASC
    LIMIT $1
    `,
    [positiveLimit(limit)]
  );

  return result.rows;
}

async function loadPaymentForRepair(client, paymentId) {
  const result = await client.query(
    `
    SELECT p.*,
           r.user_id AS reservation_user_id,
           r.listing_id,
           r.pickup_type,
           r.status AS reservation_status,
           r.payment_status AS reservation_payment_status,
           f.provider_id
    FROM payments p
    JOIN reservations r ON r.id=p.reservation_id
    LEFT JOIN food_listings f ON f.id=r.listing_id
    WHERE p.id=$1
    FOR UPDATE OF p, r
    `,
    [paymentId]
  );

  return result.rows[0] || null;
}

function reservationFromPayment(payment) {
  return {
    id: payment.reservation_id,
    user_id: payment.reservation_user_id,
    listing_id: payment.listing_id,
    pickup_type: payment.pickup_type,
    status: payment.reservation_status,
    payment_status: payment.reservation_payment_status,
    provider_id: payment.provider_id,
  };
}

function payerForPayment(payment) {
  return {
    id: payment.reservation_user_id,
    role: payment.pickup_type === "ngo" ? "ngo" : "user",
  };
}

async function ensureOwnershipForRepair(client, payment) {
  const existing = await getFinancialOwnership({
    db: client,
    reservationId: payment.reservation_id,
    paymentSessionId: payment.payment_session_id,
  });

  if (existing.length) return existing[0];

  const foodAmount = roundMoney(payment.food_amount_snapshot ?? payment.food_amount);
  const depositAmount = roundMoney(payment.reliability_deposit_amount);
  const commissionAmount = roundMoney(payment.commission_amount);
  const reservation = reservationFromPayment(payment);
  const payer = payerForPayment(payment);
  const created = await createFinancialOwnershipSnapshot({
    client,
    user: payer,
    payer,
    reservation,
    payment,
    foodAmount,
    depositAmount,
    commissionAmount,
    currency: payment.currency || "INR",
    sourceMetadata: {
      order_id: payment.order_id,
      payment_session_id: payment.payment_session_id,
      recovery_source: "financial_reconciliation_worker",
    },
  });

  return created.snapshot;
}

async function repairPaymentFinancialArtifactsInTransaction({
  client,
  paymentId,
  ensureSchema = true,
} = {}) {
  if (!client?.query) throw new Error("Database client is required");
  if (!paymentId) throw new Error("payment_id is required");

  if (ensureSchema) {
    await ensureFinancialReconciliationSchema(client);
  }

  const payment = await loadPaymentForRepair(client, paymentId);
  if (!payment) {
    return { status: "skipped", reason: "payment_not_found", paymentId };
  }

  if (payment.status !== "paid") {
    return {
      status: "skipped",
      reason: "payment_not_paid",
      paymentId: payment.id,
      reservationId: payment.reservation_id,
    };
  }

  const paymentOwnership = await ensureOwnershipForRepair(client, payment);
  if (!paymentOwnership) {
    throw new Error("payment ownership repair did not produce a snapshot");
  }

  const settlement = await recordSettlementAllocation({
    client,
    payment,
    paymentOwnership,
    metadata: {
      source: "financial_reconciliation_worker",
      repair_payment_id: payment.id,
      reservation_id: payment.reservation_id,
    },
  });

  if (!settlement?.allocation) {
    throw new Error("settlement allocation repair did not produce a snapshot");
  }

  await client.query(
    `
    UPDATE payments
    SET last_reconciled_at=NOW(),
        reconciliation_status='financial_artifacts_repaired',
        reconciliation_attempts=COALESCE(reconciliation_attempts, 0) + 1,
        updated_at=NOW()
    WHERE id=$1
    `,
    [payment.id]
  );

  return {
    status: "repaired",
    paymentId: payment.id,
    reservationId: payment.reservation_id,
    orderId: payment.order_id,
    paymentSessionId: payment.payment_session_id,
    allocationId: settlement.allocation.id,
    providerSettlementId: settlement.providerSettlement?.id || null,
    allocationInserted: settlement.inserted,
  };
}

async function recordRepairEvent(eventName, severity, metadata, emitAudit) {
  if (!emitAudit) return;
  await recordOperationalEvent({
    category: "financial",
    severity,
    eventName,
    metadata: {
      worker: "financial-reconciliation-worker",
      ...metadata,
    },
  });
}

async function repairPaidPaymentFinancialArtifacts({
  paymentId,
  client,
  emitAudit = true,
  ensureSchema = true,
} = {}) {
  await recordRepairEvent(
    "repair_started",
    "info",
    { payment_id: paymentId },
    emitAudit
  );

  try {
    const result = client
      ? await repairPaymentFinancialArtifactsInTransaction({
          client,
          paymentId,
          ensureSchema,
        })
      : await withTransaction(
          pool,
          (transactionClient) =>
            repairPaymentFinancialArtifactsInTransaction({
              client: transactionClient,
              paymentId,
              ensureSchema,
            }),
          {
            name: "financial_reconciliation_repair",
            maxAttempts: 4,
            lockTimeoutMs: 3000,
            statementTimeoutMs: 30000,
          }
        );

    await recordRepairEvent(
      "repair_completed",
      result.status === "repaired" ? "info" : "warning",
      {
        payment_id: result.paymentId || paymentId,
        reservation_id: result.reservationId || null,
        order_id: result.orderId || null,
        status: result.status,
        reason: result.reason || null,
        allocation_id: result.allocationId || null,
        provider_settlement_id: result.providerSettlementId || null,
      },
      emitAudit
    );

    return result;
  } catch (err) {
    await recordRepairEvent(
      "repair_failed",
      "error",
      {
        payment_id: paymentId,
        message: err?.message,
      },
      emitAudit
    );
    void recordAlert({
      alertKey: `financial:reconciliation_repair_failed:${paymentId}`,
      category: "financial",
      severity: "error",
      message: "Financial reconciliation repair failed",
      metadata: {
        paymentId,
        message: err?.message,
      },
    });
    throw err;
  }
}

async function runFinancialReconciliation({
  limit = DEFAULT_RECONCILIATION_LIMIT,
} = {}) {
  await ensureFinancialReconciliationSchema(pool);
  const candidates = await findPaidPaymentsMissingFinancialArtifacts({
    client: pool,
    limit,
    ensureSchema: false,
  });
  const results = [];

  for (const payment of candidates) {
    try {
      const result = await repairPaidPaymentFinancialArtifacts({
        paymentId: payment.id,
        ensureSchema: false,
      });
      results.push(result);
    } catch (err) {
      logger.error("Financial reconciliation payment repair failed", {
        err,
        paymentId: payment.id,
        reservationId: payment.reservation_id,
      });
      results.push({
        status: "failed",
        paymentId: payment.id,
        reservationId: payment.reservation_id,
        message: err?.message,
      });
    }
  }

  logger.payment("Financial reconciliation sweep completed", {
    scanned: candidates.length,
    repaired: results.filter((result) => result.status === "repaired").length,
    failed: results.filter((result) => result.status === "failed").length,
  });

  return results;
}

module.exports = {
  DEFAULT_RECONCILIATION_LIMIT,
  findPaidPaymentsMissingFinancialArtifacts,
  paidPaymentMissingArtifactsPredicate,
  repairPaidPaymentFinancialArtifacts,
  repairPaymentFinancialArtifactsInTransaction,
  runFinancialReconciliation,
};
