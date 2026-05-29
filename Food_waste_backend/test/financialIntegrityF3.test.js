const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isIllegalPaymentTransition,
  normalizeRefundStatusFromGateway,
  shouldApplyRefundWebhook,
} = require("../shared/services/financialStateMachine.service");
const {
  classifyDeadLetter,
} = require("../shared/utils/queueFailureClassification");

test("refund webhook state machine rejects stale pending after failed terminal", () => {
  assert.equal(normalizeRefundStatusFromGateway("SUCCESS"), "refunded");
  assert.equal(normalizeRefundStatusFromGateway("FAILED"), "refund_failed");
  assert.equal(normalizeRefundStatusFromGateway("PENDING"), "refund_pending");

  assert.equal(
    shouldApplyRefundWebhook({
      currentStatus: "refund_failed",
      incomingStatus: "refund_pending",
    }),
    false
  );
  assert.equal(
    shouldApplyRefundWebhook({
      currentStatus: "refund_failed",
      incomingStatus: "refund_pending",
      allowRetryTransition: true,
    }),
    true
  );
  assert.equal(
    shouldApplyRefundWebhook({
      currentStatus: "refunded",
      incomingStatus: "refund_failed",
    }),
    false
  );
});

test("payment state machine prevents double-terminal regressions", () => {
  assert.equal(isIllegalPaymentTransition("paid", "failed"), true);
  assert.equal(isIllegalPaymentTransition("refunded", "refund_pending"), true);
  assert.equal(isIllegalPaymentTransition("failed", "paid"), true);
  assert.equal(isIllegalPaymentTransition("failed", "refund_pending"), false);
  assert.equal(isIllegalPaymentTransition("refund_failed", "refund_pending"), false);
});

test("financial queue dead letters are classified as replay-safe", () => {
  const refund = classifyDeadLetter(
    "refund-queue",
    { name: "refund-payment", failedReason: "network timeout" },
    new Error("network timeout")
  );
  const payment = classifyDeadLetter(
    "payment-queue",
    { name: "payment-reconciliation-sweep" },
    new Error("db retry exhausted")
  );

  assert.equal(refund.category, "financial_refund");
  assert.equal(refund.retrySafe, true);
  assert.equal(refund.reconciliationPath, "refund-reconciliation-sweep");
  assert.equal(refund.reason, "gateway_uncertain");

  assert.equal(payment.category, "financial_payment");
  assert.equal(payment.retrySafe, true);
  assert.equal(payment.reconciliationPath, "payment-reconciliation-sweep");
});
