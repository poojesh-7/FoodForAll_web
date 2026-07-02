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

  const financialRepair = classifyDeadLetter(
    "financial-reconciliation-worker",
    { name: "financial-reconciliation-sweep" },
    new Error("db retry exhausted")
  );

  assert.equal(financialRepair.category, "financial_reconciliation");
  assert.equal(financialRepair.retrySafe, true);
  assert.equal(
    financialRepair.reconciliationPath,
    "financial-reconciliation-sweep"
  );
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

test("createPayment freezes payment financial terms before settlement", () => {
  const service = repoFile(
    "Food_waste_backend",
    "shared",
    "services",
    "payment.service.js"
  );
  const reconciliation = repoFile(
    "Food_waste_backend",
    "shared",
    "services",
    "paymentReconciliation.service.js"
  );

  assert.match(service, /buildPaymentFinancialTerms\(\{\s*foodAmount\s*\}\)/);
  assert.match(service, /commission_percent,\s*commission_amount,\s*provider_amount,/);
  assert.match(service, /food_amount_snapshot,\s*platform_amount/);
  assert.match(service, /commissionAmount:\s*financialTerms\.commission_amount/);
  assert.match(reconciliation, /commission_percent:\s*financialTerms\.commission_percent/);
  assert.match(reconciliation, /food_amount_snapshot:\s*financialTerms\.food_amount_snapshot/);
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

test("stale payment sweep carries expired reservation ids into local release", () => {
  const reconciliation = repoFile(
    "Food_waste_backend",
    "shared",
    "services",
    "paymentReconciliation.service.js"
  );
  const sweepStart = reconciliation.indexOf(
    "async function reconcileStalePaymentSessions"
  );
  const sweepBlock = reconciliation.slice(sweepStart, sweepStart + 5200);
  const orderStart = reconciliation.indexOf("async function reconcileOrder");
  const orderBlock = reconciliation.slice(orderStart, orderStart + 2600);

  assert.match(sweepBlock, /SELECT r\.id AS reservation_id,\s+p\.order_id/s);
  assert.match(sweepBlock, /reservationsByOrderId/);
  assert.match(sweepBlock, /expiredReservationIds:\s*reservationIds/);
  assert.match(orderBlock, /expiredReservationIds = \[\]/);
  assert.match(orderBlock, /expirePendingReservationsByIds\(/);
  assert.match(orderBlock, /paymentStatus:\s*"expired"/);
});

test("payment timeout worker uses BullMQ v5 job scheduler for repeat sweep", () => {
  const worker = repoFile(
    "Food_waste_backend",
    "workers",
    "paymentTimeout.worker.js"
  );

  assert.match(worker, /upsertJobScheduler\(/);
  assert.match(worker, /removeRepeatable\(/);
  assert.doesNotMatch(worker, /paymentQueue\.add\(\s*[\r\n\s]*["']payment-reconciliation-sweep["'][\s\S]*repeat:\s*\{/);
  assert.match(worker, /PAYMENT_RECONCILIATION_SWEEP_MS/);
  assert.match(worker, /locallyExpiredReservations/);
});
