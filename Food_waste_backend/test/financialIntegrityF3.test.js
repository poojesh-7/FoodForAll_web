const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

function repoFile(...segments) {
  return fs.readFileSync(path.resolve(__dirname, "..", "..", ...segments), "utf8");
}

test("payment order attempt writers are transaction-client aware", () => {
  const reconciliation = repoFile(
    "Food_waste_backend",
    "shared",
    "services",
    "paymentReconciliation.service.js"
  );

  assert.match(reconciliation, /async function recordPaymentOrderAttempt\(\{\s+client = pool,/s);
  assert.match(
    reconciliation,
    /async function markPaymentOrderAttemptGatewayCreated\(\{\s+client = pool,/s
  );
  assert.match(
    reconciliation,
    /async function markPaymentOrderAttemptDbInserted\(\{\s*client = pool,\s*orderId\s*\}/s
  );
  assert.match(
    reconciliation,
    /async function markPaymentOrderAttemptFailed\(\{\s*client = pool,\s*orderId,\s*err\s*\}/s
  );
  assert.equal((reconciliation.match(/const db = client \|\| pool;/g) || []).length, 4);
});

test("restricted NGO reserve payment path passes its transaction into payment creation", () => {
  const controller = repoFile("Food_waste_backend", "controllers", "ngo.controller.js");
  const handlerStart = controller.indexOf("exports.bulkReserve = async");
  const paymentCall = controller.indexOf("await createReservationPayment({", handlerStart);
  const paymentBlock = controller.slice(paymentCall, paymentCall + 160);

  assert.ok(handlerStart >= 0);
  assert.ok(paymentCall > handlerStart);
  assert.match(paymentBlock, /client,\s+user:\s*req\.user,\s+reservations:\s*paymentReservations/s);
});

test("createPayment keeps attempt transitions inside the caller transaction", () => {
  const service = repoFile(
    "Food_waste_backend",
    "shared",
    "services",
    "payment.service.js"
  );

  assert.match(service, /recordPaymentOrderAttempt\(\{\s+client,/s);
  assert.match(service, /markPaymentOrderAttemptGatewayCreated\(\{\s+client,/s);
  assert.match(service, /markPaymentOrderAttemptDbInserted\(\{\s+client,\s*orderId/s);
  assert.match(service, /markPaymentOrderAttemptFailed\(\{\s+client,\s*orderId,\s*err/s);
});

test("recovery sweep delays live payment creation states", () => {
  const reconciliation = repoFile(
    "Food_waste_backend",
    "shared",
    "services",
    "paymentReconciliation.service.js"
  );
  const claimStart = reconciliation.indexOf(
    "async function claimRecoverablePaymentOrderAttempts"
  );
  const claimBlock = reconciliation.slice(claimStart, claimStart + 1200);

  assert.match(claimBlock, /status IN \('creating','gateway_created'\)/);
  assert.match(claimBlock, /updated_at < NOW\(\) - INTERVAL '10 minutes'/);
  assert.match(claimBlock, /status IN \('db_inserted','recovery_pending','failed'\)/);
  assert.match(claimBlock, /updated_at < NOW\(\) - INTERVAL '2 minutes'/);
});

test("recovery sweep suppresses duplicate overlap with row locks", () => {
  const reconciliation = repoFile(
    "Food_waste_backend",
    "shared",
    "services",
    "paymentReconciliation.service.js"
  );
  const claimStart = reconciliation.indexOf(
    "async function claimRecoverablePaymentOrderAttempts"
  );
  const claimBlock = reconciliation.slice(claimStart, claimStart + 1200);

  assert.match(claimBlock, /SET status='recovery_pending'/);
  assert.match(claimBlock, /recovery_attempts=recovery_attempts \+ 1/);
  assert.match(claimBlock, /FOR UPDATE SKIP LOCKED/);
});
