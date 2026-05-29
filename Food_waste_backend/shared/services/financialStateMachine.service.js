function normalizeRefundStatusFromGateway(status) {
  const normalized = String(status || "").toUpperCase();

  if (normalized === "SUCCESS") return "refunded";
  if (normalized === "FAILED" || normalized === "CANCELLED") return "refund_failed";
  return "refund_pending";
}

function shouldApplyRefundWebhook({
  currentStatus,
  incomingStatus,
  allowRetryTransition = false,
}) {
  const current = String(currentStatus || "").toLowerCase();
  const incoming = String(incomingStatus || "").toLowerCase();

  if (!incoming) return false;
  if (current === "refunded") return false;
  if (incoming === "refunded") return true;
  if (incoming === "refund_failed") return current !== "refunded";
  if (incoming === "refund_pending") {
    if (allowRetryTransition) return current !== "refunded";
    return !["refunded", "refund_failed", "retained"].includes(current);
  }

  return false;
}

function isIllegalPaymentTransition(oldStatus, newStatus) {
  const oldValue = String(oldStatus || "created").toLowerCase();
  const newValue = String(newStatus || oldValue).toLowerCase();

  if (oldValue === newValue) return false;
  if (oldValue === "refunded") return true;
  if (oldValue === "paid") {
    return ["created", "pending", "failed", "expired"].includes(newValue);
  }
  if (oldValue === "refund_pending") {
    return ["created", "pending", "paid", "failed", "expired"].includes(newValue);
  }
  if (oldValue === "refund_failed") {
    return ["created", "pending", "paid", "failed", "expired"].includes(newValue);
  }
  if (["failed", "expired"].includes(oldValue)) {
    return ["created", "pending", "paid"].includes(newValue);
  }

  return false;
}

module.exports = {
  isIllegalPaymentTransition,
  normalizeRefundStatusFromGateway,
  shouldApplyRefundWebhook,
};
