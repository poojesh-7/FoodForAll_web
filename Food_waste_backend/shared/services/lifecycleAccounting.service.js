const logger = require("../utils/logger");
const {
  getFinancialOwnership,
} = require("./financialOwnership.service");
const {
  ROUTING_VERSION,
  resolveRefundPlan,
  roundMoney,
} = require("./refundRouting.service");
const {
  prepareRefundExecution,
} = require("./refundExecution.service");
const {
  incrementCounter,
} = require("./metrics.service");
const {
  recordOperationalEvent,
} = require("./observability.service");

function normalizeToken(value, fallback = "unspecified") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function normalizeOperationSource(value) {
  const source = normalizeToken(value);
  const aliases = {
    cancelled: "cancellation",
    cancel: "cancellation",
    reservation_cancelled: "cancellation",
    reservation_expiry: "reservation_expired",
    pickup_timeout: "volunteer_pickup_failed",
    delivery_timeout: "volunteer_delivery_failed",
    pickup_failed: "user_failed_pickup",
    delivery_failed: "volunteer_delivery_failed",
    successful_pickup: "successful_pickup",
    successful_delivery: "successful_delivery",
  };

  return aliases[source] || source;
}

function inferOperationSource({
  terminalReason,
  lifecycleState = {},
  actorContext = {},
  reservation = {},
}) {
  const explicit =
    terminalReason ||
    lifecycleState.operationSource ||
    lifecycleState.operation_source ||
    lifecycleState.source ||
    actorContext.operationSource ||
    actorContext.operation_source;

  if (explicit) return normalizeOperationSource(explicit);

  const outcome = normalizeToken(lifecycleState.outcome, "");
  if (outcome === "success") {
    return reservation.pickup_type === "ngo"
      ? "successful_delivery"
      : "successful_pickup";
  }

  if (outcome === "failure") {
    return reservation.pickup_type === "ngo"
      ? "volunteer_delivery_failed"
      : "user_failed_pickup";
  }

  if (outcome === "cancellation") {
    return reservation.pickup_type === "ngo" ? "ngo_cancelled" : "user_cancelled";
  }

  return "unspecified";
}

function classifySource(operationSource) {
  const source = normalizeOperationSource(operationSource);

  if (source === "payment_cancelled_before_confirmation") {
    return "payment_timeout";
  }
  if (source === "payment_timeout") return "payment_timeout";
  if (source.includes("cancel")) return "cancellation";
  if (source.includes("successful")) return "success";
  if (
    source.includes("failed") ||
    source.includes("expired") ||
    source.includes("timeout")
  ) {
    return "failure";
  }

  return "terminal";
}

function classifyLifecycleState(lifecycleState = {}) {
  const outcome = normalizeToken(lifecycleState.outcome, "");
  if (outcome === "cancellation") return "cancellation";
  if (outcome === "success") return "success";
  if (outcome === "failure") return "failure";
  if (outcome === "payment_timeout") return "payment_timeout";
  return null;
}

function lifecycleStateForSource({ operationSource, lifecycleState = {} }) {
  const source = normalizeOperationSource(operationSource);
  const category = source === "payment_timeout"
    ? "payment_timeout"
    : classifyLifecycleState(lifecycleState) || classifySource(source);

  if (category === "cancellation") {
    return {
      ...lifecycleState,
      refundType: "payment",
      outcome: "cancellation",
    };
  }

  if (category === "success") {
    return {
      ...lifecycleState,
      refundType: "reliability_deposit",
      outcome: "success",
    };
  }

  if (category === "failure") {
    return {
      ...lifecycleState,
      refundType: "reliability_deposit",
      outcome: "failure",
    };
  }

  return {
    ...lifecycleState,
    refundType: "none",
    outcome: category,
  };
}

function basePlanMetadata({
  reservation,
  payment,
  paymentOwnership,
  operationSource,
  category,
  actorContext = {},
}) {
  return {
    routingVersion: ROUTING_VERSION,
    routingSource: "payment_ownership",
    paymentOwnershipId: String(paymentOwnership.id),
    reservationId: String(paymentOwnership.reservation_id || reservation?.id),
    paymentSessionId: String(
      paymentOwnership.payment_session_id || payment?.payment_session_id
    ),
    ownershipVersion: Number(paymentOwnership.ownership_version || 1),
    snapshotHash: paymentOwnership.snapshot_hash || null,
    refundScope: "none",
    lifecycleOutcome: category,
    operationSource,
    terminalReason: operationSource,
    actorUserId: actorContext.actorUserId || actorContext.userId || null,
    actorRole: actorContext.actorRole || actorContext.role || "system",
    payerRole: paymentOwnership.payer_role || null,
    refundTargetRole: paymentOwnership.refund_target_role || null,
  };
}

function buildNoopAccountingPlan({
  reservation,
  payment,
  paymentOwnership,
  operationSource,
  category,
  actorContext,
}) {
  return {
    refunds: [],
    retainedAmounts: [],
    payouts: [],
    commissions: [],
    metadata: basePlanMetadata({
      reservation,
      payment,
      paymentOwnership,
      operationSource,
      category,
      actorContext,
    }),
  };
}

function buildRoutedPlan({
  reservation,
  payment,
  paymentOwnership,
  lifecycleState,
  operationSource,
  category,
  terminalReason,
  actorContext,
}) {
  if (category === "payment_timeout") {
    return buildNoopAccountingPlan({
      reservation,
      payment,
      paymentOwnership,
      operationSource,
      category,
      actorContext,
    });
  }

  const routed = resolveRefundPlan({
    reservation,
    payment,
    paymentOwnership,
    lifecycleState,
    cancellationReason: category === "cancellation" ? terminalReason : null,
    failureReason: category === "failure" ? terminalReason : null,
  });

  return {
    ...routed,
    metadata: {
      ...routed.metadata,
      ...basePlanMetadata({
        reservation,
        payment,
        paymentOwnership,
        operationSource,
        category,
        actorContext,
      }),
      refundScope: routed.metadata.refundScope,
      lifecycleOutcome: routed.metadata.lifecycleOutcome,
    },
  };
}

function operationTypeForAccounting({ plan, category }) {
  if ((plan.retainedAmounts || []).length > 0) return "deposit_retention";
  if ((plan.refunds || []).length > 0) {
    return category === "success" ? "deposit_refund" : "payment_refund";
  }
  return "lifecycle_accounting";
}

function amountForPlan(plan) {
  const refunds = plan.refunds || [];
  const retained = plan.retainedAmounts || [];

  return roundMoney(
    [...refunds, ...retained].reduce(
      (sum, item) => sum + roundMoney(item.amount),
      0
    )
  );
}

function isNgoZeroLiabilityFlow({
  reservation = {},
  paymentOwnership,
  plan,
  category,
}) {
  if (reservation.pickup_type !== "ngo") return false;
  if (!["cancellation", "success", "failure"].includes(category)) return false;

  return (
    roundMoney(paymentOwnership.food_amount) === 0 &&
    roundMoney(paymentOwnership.deposit_amount) === 0 &&
    roundMoney(paymentOwnership.commission_amount) === 0 &&
    amountForPlan(plan) === 0
  );
}

function validateLifecycleAccountingInvariant({
  reservation = {},
  paymentOwnership,
  plan,
  category,
  operationSource,
  operationType,
}) {
  const failures = [];
  const depositAmount = roundMoney(paymentOwnership.deposit_amount);
  const restricted = depositAmount > 0;
  const refunds = plan.refunds || [];
  const retained = plan.retainedAmounts || [];

  if (restricted && category === "cancellation" && !refunds.length) {
    failures.push("restricted cancellation did not produce a refund operation");
  }

  if (restricted && category === "failure" && !retained.length) {
    failures.push("restricted failure did not produce a retention operation");
  }

  if (restricted && category === "success" && !refunds.length) {
    failures.push("restricted success did not produce a deposit refund operation");
  }

  if (operationType === "lifecycle_accounting" && amountForPlan(plan) > 0) {
    failures.push("positive financial amount was mapped to no-op accounting");
  }

  for (const refund of refunds) {
    if (refund.actorRole === "provider") {
      failures.push("provider cannot receive refund accounting");
    }
    if (
      paymentOwnership.provider_id &&
      refund.actorUserId &&
      String(refund.actorUserId) === String(paymentOwnership.provider_id)
    ) {
      failures.push("provider user id leaked into refund accounting");
    }
    if (
      reservation.assigned_volunteer_id &&
      refund.actorUserId &&
      String(refund.actorUserId) === String(reservation.assigned_volunteer_id)
    ) {
      failures.push("volunteer user id leaked into refund accounting");
    }
  }

  if (
    operationSource.includes("volunteer") &&
    restricted &&
    retained[0]?.actorRole !== "platform"
  ) {
    failures.push("volunteer failure did not retain deposit to platform");
  }

  return failures;
}

function recordAccountingFailure({ operationSource, failures, reservation, payment }) {
  incrementCounter("food_rescue_accounting_invariant_failure_total", {
    operation_source: operationSource,
  });
  incrementCounter("food_rescue_lifecycle_accounting_missing_total", {
    operation_source: operationSource,
  });
  logger.error("Lifecycle accounting invariant failed", {
    operationSource,
    reservationId: reservation?.id,
    paymentId: payment?.id,
    failures,
  });
  void recordOperationalEvent({
    category: "payment",
    severity: "error",
    eventName: "lifecycle_accounting_invariant_failed",
    metadata: {
      operationSource,
      reservationId: reservation?.id,
      paymentId: payment?.id,
      failures,
      diagnosticTarget: "financial_reconciliation",
    },
  });
}

async function loadPaymentOwnershipForAccounting({
  client,
  reservation,
  payment,
  paymentOwnership,
  operationSource = "unspecified",
}) {
  if (paymentOwnership) return paymentOwnership;

  const reservationId = reservation?.id || payment?.reservation_id;
  const paymentSessionId = payment?.payment_session_id;
  if (!reservationId || !paymentSessionId) {
    incrementCounter("food_rescue_orphan_financial_state_total", {
      operation_source: operationSource,
      reason: "missing_lookup_context",
    });
    throw new Error("payment ownership lookup requires reservation and payment session");
  }

  const rows = await getFinancialOwnership({
    db: client,
    reservationId,
    paymentSessionId,
  });

  if (!rows.length) {
    incrementCounter("food_rescue_orphan_financial_state_total", {
      operation_source: operationSource,
      reason: "missing_payment_ownership",
    });
    logger.error("Lifecycle accounting missing payment ownership", {
      operationSource,
      reservationId,
      paymentId: payment?.id,
      paymentSessionId,
    });
    throw new Error("payment_ownership snapshot is required for lifecycle accounting");
  }

  return rows[0];
}

function resolveLifecycleAccounting({
  reservation,
  payment,
  paymentOwnership,
  lifecycleState = {},
  terminalReason,
  actorContext = {},
} = {}) {
  if (!paymentOwnership) {
    throw new Error("payment_ownership snapshot is required for lifecycle accounting");
  }

  const operationSource = inferOperationSource({
    terminalReason,
    lifecycleState,
    actorContext,
    reservation,
  });
  const category = operationSource === "payment_timeout"
    ? "payment_timeout"
    : classifyLifecycleState(lifecycleState) || classifySource(operationSource);
  const normalizedLifecycleState = lifecycleStateForSource({
    operationSource,
    lifecycleState,
  });
  const plan = buildRoutedPlan({
    reservation,
    payment,
    paymentOwnership,
    lifecycleState: normalizedLifecycleState,
    operationSource,
    category,
    terminalReason: terminalReason || operationSource,
    actorContext,
  });
  const operationType = operationTypeForAccounting({ plan, category });
  const status = operationType === "lifecycle_accounting" ? "skipped" : "processing";
  const invariantFailures = validateLifecycleAccountingInvariant({
    reservation,
    paymentOwnership,
    plan,
    category,
    operationSource,
    operationType,
  });
  const skipFinancialOperation = isNgoZeroLiabilityFlow({
    reservation,
    paymentOwnership,
    plan,
    category,
  });

  return {
    plan,
    operationType,
    operationSource,
    status,
    category,
    invariantFailures,
    skipFinancialOperation,
    skipReason: skipFinancialOperation ? "ngo_zero_liability" : null,
  };
}

async function prepareLifecycleAccounting({
  client,
  reservation,
  payment,
  paymentOwnership,
  lifecycleState = {},
  terminalReason,
  actorContext = {},
  refundId = null,
  metadata = {},
} = {}) {
  if (!client?.query) throw new Error("Database client is required");

  const operationSource = inferOperationSource({
    terminalReason,
    lifecycleState,
    actorContext,
    reservation,
  });
  const ownership = await loadPaymentOwnershipForAccounting({
    client,
    reservation,
    payment,
    paymentOwnership,
    operationSource,
  });
  const accounting = resolveLifecycleAccounting({
    reservation,
    payment,
    paymentOwnership: ownership,
    lifecycleState,
    terminalReason: terminalReason || operationSource,
    actorContext,
  });

  if (accounting.invariantFailures.length) {
    recordAccountingFailure({
      operationSource: accounting.operationSource,
      failures: accounting.invariantFailures,
      reservation,
      payment,
    });
    throw new Error(
      `Lifecycle accounting invariant failed: ${accounting.invariantFailures.join("; ")}`
    );
  }

  if (accounting.skipFinancialOperation) {
    incrementCounter("food_rescue_lifecycle_accounting_completed_total", {
      operation_source: accounting.operationSource,
      operation_type: "none",
      status: accounting.skipReason,
    });
    logger.payment("Lifecycle accounting skipped for zero-liability NGO flow", {
      operationSource: accounting.operationSource,
      reservationId: reservation?.id,
      paymentId: payment?.id,
      paymentOwnershipId: ownership.id,
    });

    return {
      ...accounting,
      operation: null,
      draft: null,
      duplicatePrevented: false,
      shouldExecute: false,
      accountingSkipped: true,
      paymentOwnership: ownership,
    };
  }

  const execution = await prepareRefundExecution({
    client,
    plan: accounting.plan,
    operationType: accounting.operationType,
    operationSource: accounting.operationSource,
    refundId,
    status: accounting.status,
    allowZeroAmount: accounting.operationType === "lifecycle_accounting",
    metadata: {
      ...metadata,
      operation_source: accounting.operationSource,
      terminal_reason: terminalReason || accounting.operationSource,
      lifecycle_category: accounting.category,
    },
  });

  incrementCounter("food_rescue_lifecycle_accounting_completed_total", {
    operation_source: accounting.operationSource,
    operation_type: accounting.operationType,
    status: execution.operation?.status || accounting.status,
  });

  return {
    ...accounting,
    ...execution,
    paymentOwnership: ownership,
  };
}

module.exports = {
  classifySource,
  inferOperationSource,
  loadPaymentOwnershipForAccounting,
  normalizeOperationSource,
  prepareLifecycleAccounting,
  resolveLifecycleAccounting,
  isNgoZeroLiabilityFlow,
  validateLifecycleAccountingInvariant,
};
