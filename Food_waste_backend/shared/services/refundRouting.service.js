const ROUTING_VERSION = 1;
const DEFAULT_CURRENCY = "INR";

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeText(value, fallback = null) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeCurrency(value) {
  return normalizeText(value, DEFAULT_CURRENCY).slice(0, 12).toUpperCase();
}

function normalizeLifecycleValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function lifecycleText(lifecycleState = {}) {
  return [
    lifecycleState.outcome,
    lifecycleState.status,
    lifecycleState.state,
    lifecycleState.event,
    lifecycleState.action,
    lifecycleState.reason,
    lifecycleState.refundType,
    lifecycleState.refund_type,
    lifecycleState.scope,
  ]
    .map(normalizeLifecycleValue)
    .filter(Boolean)
    .join(" ");
}

function inferRefundScope({ lifecycleState = {} }) {
  const explicit = normalizeLifecycleValue(
    lifecycleState.refundType ||
      lifecycleState.refund_type ||
      lifecycleState.scope ||
      lifecycleState.operation
  );

  if (explicit.includes("deposit") || explicit.includes("reliability")) {
    return "deposit";
  }

  if (
    explicit.includes("payment") ||
    explicit.includes("food") ||
    explicit.includes("full") ||
    explicit.includes("cancel")
  ) {
    return "payment";
  }

  return "payment";
}

function inferLifecycleOutcome({
  lifecycleState = {},
  cancellationReason,
  failureReason,
  refundScope,
}) {
  const explicit = lifecycleText(lifecycleState);
  const cancellation = normalizeLifecycleValue(cancellationReason);
  const failure = normalizeLifecycleValue(failureReason);
  const combined = [explicit, cancellation, failure].filter(Boolean).join(" ");

  if (cancellation || /\bcancell?ed?\b|\bcancel\b/.test(combined)) {
    return "cancellation";
  }

  if (
    failure ||
    /\bfail|\bmissed\b|\bno_show\b|\bexpired\b|\btimeout\b|\bunavailable\b/.test(
      combined
    )
  ) {
    return "failure";
  }

  if (
    /\bsuccess\b|\bsucceeded\b|\bcompleted\b|\bpicked_up\b|\bdelivered\b|\bfulfilled\b/.test(
      combined
    )
  ) {
    return "success";
  }

  return refundScope === "deposit" ? "success" : "cancellation";
}

function requireOwnership(paymentOwnership) {
  if (!paymentOwnership) {
    throw new Error("payment_ownership snapshot is required for refund routing");
  }

  if (!paymentOwnership.id) {
    throw new Error("payment_ownership.id is required for refund routing");
  }

  if (!paymentOwnership.reservation_id) {
    throw new Error("payment_ownership.reservation_id is required for refund routing");
  }

  if (!paymentOwnership.payment_session_id) {
    throw new Error("payment_ownership.payment_session_id is required for refund routing");
  }

  return paymentOwnership;
}

function refundActorFromOwnership(ownership, refundType) {
  if (refundType === "deposit" && ownership.deposit_owner_user_id) {
    return {
      actorUserId: String(ownership.deposit_owner_user_id),
      actorRole: normalizeText(ownership.deposit_owner_role, "unknown"),
      ownershipField: "deposit_owner",
    };
  }

  return {
    actorUserId: ownership.refund_target_user_id
      ? String(ownership.refund_target_user_id)
      : null,
    actorRole: normalizeText(ownership.refund_target_role, "unknown"),
    ownershipField: "refund_target",
  };
}

function buildRefund({ ownership, refundType, amount, currency, reason }) {
  const actor = refundActorFromOwnership(ownership, refundType);

  return {
    refundType,
    amount: roundMoney(amount),
    currency,
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
    ownershipField: actor.ownershipField,
    reason,
  };
}

function buildRetention({ ownership, retentionType, amount, currency, reason }) {
  return {
    retentionType,
    amount: roundMoney(amount),
    currency,
    actorUserId: null,
    actorRole: "platform",
    platformAccountId: ownership.platform_account_id || null,
    reason,
  };
}

function resolveRefundPlan({
  reservation,
  payment,
  paymentOwnership,
  lifecycleState = {},
  trustState,
  cancellationReason,
  failureReason,
} = {}) {
  const ownership = requireOwnership(paymentOwnership);
  const refundScope = inferRefundScope({ lifecycleState });
  const lifecycleOutcome = inferLifecycleOutcome({
    lifecycleState,
    cancellationReason,
    failureReason,
    refundScope,
  });
  const currency = normalizeCurrency(ownership.currency || payment?.currency);
  const foodAmount = roundMoney(ownership.food_amount);
  const depositAmount = roundMoney(ownership.deposit_amount);
  const refunds = [];
  const retainedAmounts = [];

  if (refundScope === "payment" && lifecycleOutcome === "cancellation") {
    if (foodAmount > 0) {
      refunds.push(
        buildRefund({
          ownership,
          refundType: "food",
          amount: foodAmount,
          currency,
          reason: "cancellation",
        })
      );
    }
  }

  if (depositAmount > 0) {
    if (lifecycleOutcome === "failure") {
      retainedAmounts.push(
        buildRetention({
          ownership,
          retentionType: "deposit",
          amount: depositAmount,
          currency,
          reason: failureReason || lifecycleState.reason || "operational_failure",
        })
      );
    } else if (
      refundScope === "deposit" ||
      (refundScope === "payment" && lifecycleOutcome === "cancellation")
    ) {
      refunds.push(
        buildRefund({
          ownership,
          refundType: "deposit",
          amount: depositAmount,
          currency,
          reason: lifecycleOutcome,
        })
      );
    }
  }

  return {
    refunds,
    retainedAmounts,
    payouts: [],
    commissions: [],
    metadata: {
      routingVersion: ROUTING_VERSION,
      routingSource: "payment_ownership",
      paymentOwnershipId: String(ownership.id),
      reservationId: String(ownership.reservation_id || reservation?.id),
      paymentSessionId: String(
        ownership.payment_session_id || payment?.payment_session_id
      ),
      ownershipVersion: Number(ownership.ownership_version || 1),
      snapshotHash: ownership.snapshot_hash || null,
      refundScope,
      lifecycleOutcome,
      cancellationReason: cancellationReason || null,
      failureReason: failureReason || null,
      trustStateObserved: Boolean(trustState),
    },
  };
}

module.exports = {
  DEFAULT_CURRENCY,
  ROUTING_VERSION,
  inferLifecycleOutcome,
  inferRefundScope,
  resolveRefundPlan,
  roundMoney,
};
