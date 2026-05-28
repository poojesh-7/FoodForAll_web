const logger = require("../utils/logger");
const {
  incrementCounter,
} = require("./metrics.service");
const {
  recordAlert,
} = require("./observability.service");

const TERMINAL_OPERATION_STATUSES = new Set([
  "succeeded",
  "skipped",
  "retained",
]);
const VALID_OPERATION_STATUSES = new Set([
  "planned",
  "processing",
  "succeeded",
  "failed",
  "skipped",
  "retained",
]);

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function formatAmount(value) {
  return roundMoney(value).toFixed(2);
}

function compactText(value, fallback = null, maxLength = 120) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function operationAmount(plan, operationType) {
  const source = operationType === "deposit_retention"
    ? plan.retainedAmounts || []
    : plan.refunds || [];

  return roundMoney(
    source.reduce((sum, item) => sum + roundMoney(item.amount), 0)
  );
}

function refundActor(plan) {
  const actors = new Map();

  for (const refund of plan.refunds || []) {
    const key = `${refund.actorUserId || "null"}:${refund.actorRole || "unknown"}`;
    actors.set(key, {
      actorUserId: refund.actorUserId || null,
      actorRole: refund.actorRole || "unknown",
    });
  }

  if (actors.size > 1) {
    throw new Error("Refund plan has multiple refund actors for one operation");
  }

  return Array.from(actors.values())[0] || {
    actorUserId: null,
    actorRole: "unknown",
  };
}

function operationActor(plan, operationType) {
  if (operationType === "deposit_retention") {
    return {
      actorUserId: null,
      actorRole: "platform",
    };
  }

  return refundActor(plan);
}

function lifecycleActor(plan, fallbackRole = "system") {
  const actorUserId = plan.metadata?.actorUserId || null;
  const actorRole =
    plan.metadata?.actorRole ||
    plan.metadata?.payerRole ||
    plan.metadata?.refundTargetRole ||
    fallbackRole;

  return {
    actorUserId,
    actorRole,
  };
}

function validateRefundPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Refund plan is required");
  }

  if (plan.metadata?.routingSource !== "payment_ownership") {
    throw new Error("Refund plan must be routed from payment_ownership");
  }

  if (!plan.metadata?.paymentOwnershipId) {
    throw new Error("Refund plan is missing payment ownership lineage");
  }

  if (!plan.metadata?.reservationId) {
    throw new Error("Refund plan is missing reservation lineage");
  }

  if (!plan.metadata?.paymentSessionId) {
    throw new Error("Refund plan is missing payment session lineage");
  }

  for (const refund of plan.refunds || []) {
    if (roundMoney(refund.amount) <= 0) {
      throw new Error("Refund plan contains a non-positive refund amount");
    }
    if (!refund.actorUserId) {
      throw new Error("Refund plan is missing refund actor");
    }
    if (refund.actorRole === "provider") {
      throw new Error("Provider cannot be a refund recipient");
    }
  }

  for (const retained of plan.retainedAmounts || []) {
    if (roundMoney(retained.amount) <= 0) {
      throw new Error("Refund plan contains a non-positive retained amount");
    }
    if (retained.actorRole !== "platform") {
      throw new Error("Retained amounts must be routed to platform");
    }
  }

  return true;
}

function buildIdempotencyKey({ plan, operationType, amount }) {
  return [
    "financial",
    operationType,
    plan.metadata.reservationId,
    plan.metadata.paymentSessionId,
    plan.metadata.paymentOwnershipId,
    formatAmount(amount),
  ].join(":");
}

function buildFinancialOperationDraft({
  plan,
  operationType,
  operationSource,
  refundId = null,
  status = "processing",
  allowZeroAmount = false,
  metadata = {},
}) {
  validateRefundPlan(plan);

  if (!VALID_OPERATION_STATUSES.has(status)) {
    throw new Error(`Invalid financial operation status: ${status}`);
  }

  const normalizedOperationType = compactText(operationType, null, 80);
  if (!normalizedOperationType) {
    throw new Error("operation_type is required");
  }

  const amount = operationAmount(plan, normalizedOperationType);
  if (amount <= 0 && !allowZeroAmount) {
    throw new Error("Financial operation amount must be positive");
  }

  const actor =
    normalizedOperationType === "lifecycle_accounting"
      ? lifecycleActor(plan, metadata.actor_role || "system")
      : operationActor(plan, normalizedOperationType);
  const currency =
    (plan.refunds || [])[0]?.currency ||
    (plan.retainedAmounts || [])[0]?.currency ||
    "INR";
  const normalizedOperationSource = compactText(
    operationSource ||
      metadata.operation_source ||
      plan.metadata?.operationSource ||
      plan.metadata?.terminalReason ||
      plan.metadata?.lifecycleOutcome,
    "unspecified",
    80
  );

  return {
    operation_type: normalizedOperationType,
    operation_source: normalizedOperationSource,
    reservation_id: plan.metadata.reservationId,
    payment_session_id: plan.metadata.paymentSessionId,
    payment_ownership_id: plan.metadata.paymentOwnershipId,
    actor_user_id: actor.actorUserId,
    actor_role: actor.actorRole,
    amount,
    currency,
    idempotency_key: buildIdempotencyKey({
      plan,
      operationType: normalizedOperationType,
      amount,
    }),
    status,
    metadata: {
      routing_source: plan.metadata.routingSource,
      routing_version: plan.metadata.routingVersion,
      refund_scope: plan.metadata.refundScope,
      lifecycle_outcome: plan.metadata.lifecycleOutcome,
      operation_source: normalizedOperationSource,
      payment_ownership_id: plan.metadata.paymentOwnershipId,
      ownership_version: plan.metadata.ownershipVersion,
      snapshot_hash: plan.metadata.snapshotHash,
      refund_id: refundId || null,
      refunds: plan.refunds || [],
      retained_amounts: plan.retainedAmounts || [],
      ...metadata,
    },
  };
}

async function insertOperation(client, draft) {
  const result = await client.query(
    `
    INSERT INTO financial_operations (
      operation_type, operation_source, reservation_id, payment_session_id, payment_ownership_id,
      actor_user_id, actor_role, amount, currency, idempotency_key, status,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
    `,
    [
      draft.operation_type,
      draft.operation_source,
      draft.reservation_id,
      draft.payment_session_id,
      draft.payment_ownership_id,
      draft.actor_user_id,
      draft.actor_role,
      draft.amount,
      draft.currency,
      draft.idempotency_key,
      draft.status,
      JSON.stringify(draft.metadata || {}),
    ]
  );

  return result.rows[0] || null;
}

async function findOperationByIdempotencyKey(client, idempotencyKey) {
  const result = await client.query(
    `
    SELECT *
    FROM financial_operations
    WHERE idempotency_key=$1
    LIMIT 1
    `,
    [idempotencyKey]
  );

  return result.rows[0] || null;
}

async function bumpRetry(client, operation, metadata = {}) {
  const result = await client.query(
    `
    UPDATE financial_operations
    SET status='processing',
        retry_count=retry_count + 1,
        metadata=metadata || $2::jsonb,
        updated_at=NOW()
    WHERE id=$1
    RETURNING *
    `,
    [
      operation.id,
      JSON.stringify({
        last_retry_at: new Date().toISOString(),
        ...metadata,
      }),
    ]
  );

  return result.rows[0] || operation;
}

async function prepareRefundExecution({
  client,
  plan,
  operationType,
  operationSource,
  refundId = null,
  status = "processing",
  allowZeroAmount = false,
  metadata = {},
}) {
  if (!client?.query) throw new Error("Database client is required");

  const draft = buildFinancialOperationDraft({
    plan,
    operationType,
    operationSource,
    refundId,
    status,
    allowZeroAmount,
    metadata,
  });

  const inserted = await insertOperation(client, draft);
  if (inserted) {
    incrementCounter("food_rescue_financial_operations_total", {
      operation_type: draft.operation_type,
      status: draft.status === "skipped" ? "skipped" : "created",
      operation_source: draft.operation_source,
    });
    logger.payment("Financial operation created", {
      operationType: draft.operation_type,
      operationSource: draft.operation_source,
      reservationId: draft.reservation_id,
      paymentSessionId: draft.payment_session_id,
      paymentOwnershipId: draft.payment_ownership_id,
      amount: draft.amount,
      idempotencyKey: draft.idempotency_key,
    });

    return {
      operation: inserted,
      draft,
      duplicatePrevented: false,
      shouldExecute: !TERMINAL_OPERATION_STATUSES.has(draft.status),
    };
  }

  const existing = await findOperationByIdempotencyKey(
    client,
    draft.idempotency_key
  );
  if (!existing) {
    throw new Error("Financial operation duplicate lookup failed");
  }

  incrementCounter("food_rescue_refund_duplicate_operations_total", {
    operation_type: draft.operation_type,
    status: existing.status || "unknown",
    operation_source: existing.operation_source || draft.operation_source,
  });
  logger.warn("Duplicate financial operation prevented", {
    operationType: draft.operation_type,
    operationSource: draft.operation_source,
    reservationId: draft.reservation_id,
    paymentSessionId: draft.payment_session_id,
    paymentOwnershipId: draft.payment_ownership_id,
    idempotencyKey: draft.idempotency_key,
    existingStatus: existing.status,
  });

  if (TERMINAL_OPERATION_STATUSES.has(existing.status)) {
    return {
      operation: existing,
      draft,
      duplicatePrevented: true,
      shouldExecute: false,
    };
  }

  const retried = await bumpRetry(client, existing, {
    duplicate_retry: true,
    refund_id: refundId || existing.metadata?.refund_id || null,
  });

  incrementCounter("food_rescue_refund_retry_operations_total", {
    operation_type: draft.operation_type,
  });

  return {
    operation: retried,
    draft,
    duplicatePrevented: true,
    shouldExecute: true,
  };
}

async function markFinancialOperationStatus({
  client,
  operationId,
  idempotencyKey,
  status,
  metadata = {},
}) {
  if (!VALID_OPERATION_STATUSES.has(status)) {
    throw new Error(`Invalid financial operation status: ${status}`);
  }

  if (!operationId && !idempotencyKey) return null;

  const where = operationId ? "id=$1" : "idempotency_key=$1";
  const key = operationId || idempotencyKey;
  const result = await client.query(
    `
    UPDATE financial_operations
    SET status=$2,
        metadata=metadata || $3::jsonb,
        updated_at=NOW()
    WHERE ${where}
    RETURNING *
    `,
    [
      key,
      status,
      JSON.stringify({
        status_recorded_at: new Date().toISOString(),
        ...metadata,
      }),
    ]
  );

  if (!result.rows.length) {
    void recordAlert({
      alertKey: `payment:financial_operation_missing:${key}`,
      category: "payment",
      severity: "warning",
      message: "Financial operation status update missed its operation row",
      metadata: { key, status },
    });
    return null;
  }

  incrementCounter("food_rescue_financial_operations_total", {
    operation_type: result.rows[0].operation_type,
    status,
  });

  return result.rows[0];
}

async function markFinancialOperationStatusByRefundId({
  client,
  refundId,
  status,
  metadata = {},
}) {
  if (!refundId) return [];
  if (!VALID_OPERATION_STATUSES.has(status)) {
    throw new Error(`Invalid financial operation status: ${status}`);
  }

  const result = await client.query(
    `
    UPDATE financial_operations
    SET status=$2,
        metadata=metadata || $3::jsonb,
        updated_at=NOW()
    WHERE metadata->>'refund_id'=$1
    RETURNING *
    `,
    [
      refundId,
      status,
      JSON.stringify({
        refund_id: refundId,
        status_recorded_at: new Date().toISOString(),
        ...metadata,
      }),
    ]
  );

  for (const row of result.rows) {
    incrementCounter("food_rescue_financial_operations_total", {
      operation_type: row.operation_type,
      status,
    });
  }

  return result.rows;
}

function operationStatusFromRefundStatus(refundStatus) {
  if (refundStatus === "refunded") return "succeeded";
  if (refundStatus === "refund_failed") return "failed";
  return "processing";
}

module.exports = {
  buildFinancialOperationDraft,
  markFinancialOperationStatus,
  markFinancialOperationStatusByRefundId,
  operationStatusFromRefundStatus,
  prepareRefundExecution,
  validateRefundPlan,
};
