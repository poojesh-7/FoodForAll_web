const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveRefundPlan,
} = require("../shared/services/refundRouting.service");
const {
  buildFinancialOperationDraft,
  markFinancialOperationStatus,
  markFinancialOperationStatusByRefundId,
  prepareRefundExecution,
  validateRefundPlan,
} = require("../shared/services/refundExecution.service");
const {
  ACCOUNTING_CATEGORIES,
} = require("../shared/services/financialLedger.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const RESERVATION_ID = "55555555-5555-4555-8555-555555555555";
const OWNERSHIP_ID = "66666666-6666-4666-8666-666666666666";

function ownership(overrides = {}) {
  return {
    id: OWNERSHIP_ID,
    reservation_id: RESERVATION_ID,
    payment_session_id: "session_f2_execution",
    payer_user_id: USER_ID,
    payer_role: "user",
    provider_id: PROVIDER_ID,
    beneficiary_user_id: PROVIDER_ID,
    beneficiary_role: "provider",
    deposit_owner_user_id: USER_ID,
    deposit_owner_role: "user",
    refund_target_user_id: USER_ID,
    refund_target_role: "user",
    food_amount: 100,
    deposit_amount: 20,
    currency: "INR",
    ownership_version: 1,
    snapshot_hash: "snapshot-hash",
    ...overrides,
  };
}

function cancellationPlan() {
  return resolveRefundPlan({
    paymentOwnership: ownership(),
    lifecycleState: {
      refundType: "payment",
      outcome: "cancellation",
    },
  });
}

function depositPlan() {
  return resolveRefundPlan({
    paymentOwnership: ownership(),
    lifecycleState: {
      refundType: "reliability_deposit",
      outcome: "success",
    },
  });
}

function createOperationClient() {
  const operations = new Map();
  const ledger = new Map();
  const classifications = new Map();
  const terminal = new Map();

  function rowFromInsert(params) {
    return {
      id: `77777777-7777-4777-8777-${String(operations.size + 1).padStart(12, "0")}`,
      operation_type: params[0],
      operation_source: params[1],
      reservation_id: params[2],
      payment_session_id: params[3],
      payment_ownership_id: params[4],
      actor_user_id: params[5],
      actor_role: params[6],
      amount: params[7],
      currency: params[8],
      idempotency_key: params[9],
      status: params[10],
      retry_count: 0,
      metadata: JSON.parse(params[11]),
    };
  }

  function mergeMetadata(row, rawMetadata) {
    row.metadata = {
      ...(row.metadata || {}),
      ...JSON.parse(rawMetadata || "{}"),
    };
  }

  return {
    operations,
    ledger,
    classifications,
    terminal,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("INSERT INTO financial_operations")) {
        const row = rowFromInsert(params);
        if (operations.has(row.idempotency_key)) return { rows: [] };
        operations.set(row.idempotency_key, row);
        return { rows: [row] };
      }

      if (text.includes("INSERT INTO financial_ledger_entries")) {
        const key = params[18];
        if (ledger.has(key)) return { rows: [] };
        const row = {
          id: `ledger_${ledger.size + 1}`,
          reservation_id: params[0],
          payment_id: params[1],
          payment_session_id: params[2],
          payment_ownership_id: params[3],
          settlement_allocation_id: params[4],
          provider_settlement_id: params[5],
          settlement_batch_id: params[6],
          event_type: params[7],
          amount: params[8],
          currency: params[9],
          actor_user_id: params[10],
          actor_role: params[11],
          counterparty_user_id: params[12],
          counterparty_role: params[13],
          refund_id: params[14],
          source_type: params[15],
          source_id: params[16],
          accounting_category: params[17],
          idempotency_key: key,
          metadata: JSON.parse(params[19] || "{}"),
        };
        ledger.set(key, row);
        return { rows: [{ ...row }] };
      }

      if (
        text.includes("FROM financial_ledger_entries") &&
        text.includes("WHERE idempotency_key=$1")
      ) {
        return { rows: [ledger.get(params[0])].filter(Boolean).map((row) => ({ ...row })) };
      }

      if (text.includes("INSERT INTO financial_accounting_classifications")) {
        const key = params[12];
        if (classifications.has(key)) return { rows: [] };
        const row = {
          id: `classification_${classifications.size + 1}`,
          financial_ledger_entry_id: params[0],
          reservation_id: params[1],
          payment_id: params[2],
          payment_session_id: params[3],
          provider_settlement_id: params[4],
          accounting_category: params[5],
          source_event_type: params[6],
          amount: params[7],
          currency: params[8],
          refund_id: params[9],
          source_type: params[10],
          source_id: params[11],
          idempotency_key: key,
          metadata: JSON.parse(params[13] || "{}"),
        };
        classifications.set(key, row);
        return { rows: [{ ...row }] };
      }

      if (text.includes("INSERT INTO financial_refund_terminal_records")) {
        const key = params[7];
        if (!terminal.has(key)) {
          terminal.set(key, {
            refund_type: params[2],
            terminal_status: params[4],
            amount: params[5],
          });
        }
        return { rows: [] };
      }

      if (text.includes("FROM financial_operations")) {
        return { rows: [operations.get(params[0])].filter(Boolean) };
      }

      if (text.includes("WHERE metadata->>'refund_id'=$1")) {
        const rows = Array.from(operations.values()).filter(
          (row) => row.metadata?.refund_id === params[0]
        );
        for (const row of rows) {
          row.status = params[1];
          mergeMetadata(row, params[2]);
        }
        return { rows };
      }

      if (text.includes("UPDATE financial_operations")) {
        const row = Array.from(operations.values()).find(
          (operation) =>
            operation.id === params[0] ||
            operation.idempotency_key === params[0]
        );
        if (!row) return { rows: [] };

        if (text.includes("retry_count=retry_count + 1")) {
          row.status = "processing";
          row.retry_count += 1;
          mergeMetadata(row, params[1]);
        } else {
          row.status = params[1];
          mergeMetadata(row, params[2]);
        }

        return { rows: [row] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("financial operation draft is deterministic and ownership-lined", () => {
  const plan = cancellationPlan();
  const first = buildFinancialOperationDraft({
    plan,
    operationType: "payment_refund",
    refundId: "refund-1",
  });
  const second = buildFinancialOperationDraft({
    plan,
    operationType: "payment_refund",
    refundId: "refund-2",
  });

  assert.equal(first.amount, 120);
  assert.equal(first.actor_user_id, USER_ID);
  assert.equal(first.actor_role, "user");
  assert.equal(first.payment_ownership_id, OWNERSHIP_ID);
  assert.equal(first.idempotency_key, second.idempotency_key);
  assert.equal(first.metadata.routing_source, "payment_ownership");
});

test("refund execution is idempotent across retries and terminal duplicates", async () => {
  const client = createOperationClient();
  const plan = cancellationPlan();
  const first = await prepareRefundExecution({
    client,
    plan,
    operationType: "payment_refund",
    refundId: "refund-payment-1",
  });
  const retry = await prepareRefundExecution({
    client,
    plan,
    operationType: "payment_refund",
    refundId: "refund-payment-1",
  });

  assert.equal(first.shouldExecute, true);
  assert.equal(first.duplicatePrevented, false);
  assert.equal(retry.shouldExecute, true);
  assert.equal(retry.duplicatePrevented, true);
  assert.equal(retry.operation.retry_count, 1);
  assert.equal(client.operations.size, 1);

  await markFinancialOperationStatus({
    client,
    operationId: first.operation.id,
    status: "succeeded",
    metadata: { gateway_status: "SUCCESS" },
  });

  const replay = await prepareRefundExecution({
    client,
    plan,
    operationType: "payment_refund",
    refundId: "refund-payment-1",
  });

  assert.equal(replay.duplicatePrevented, true);
  assert.equal(replay.shouldExecute, false);
  assert.equal(client.operations.size, 1);
  assert.deepEqual(
    Array.from(client.classifications.values()).map((row) => row.accounting_category),
    [ACCOUNTING_CATEGORIES.REFUND_EXPENSE]
  );
});

test("concurrent duplicate preparation creates one financial operation", async () => {
  const client = createOperationClient();
  const plan = depositPlan();
  const results = await Promise.all([
    prepareRefundExecution({
      client,
      plan,
      operationType: "deposit_refund",
      refundId: "refund-deposit-1",
    }),
    prepareRefundExecution({
      client,
      plan,
      operationType: "deposit_refund",
      refundId: "refund-deposit-1",
    }),
  ]);

  assert.equal(client.operations.size, 1);
  assert.equal(results.filter((result) => result.duplicatePrevented).length, 1);
  assert.equal(results.every((result) => result.shouldExecute), true);
});

test("webhook replay status updates are safe and repeatable", async () => {
  const client = createOperationClient();
  const plan = depositPlan();
  await prepareRefundExecution({
    client,
    plan,
    operationType: "deposit_refund",
    refundId: "refund-deposit-webhook",
  });

  const first = await markFinancialOperationStatusByRefundId({
    client,
    refundId: "refund-deposit-webhook",
    status: "succeeded",
    metadata: { source: "cashfree_webhook" },
  });
  const replay = await markFinancialOperationStatusByRefundId({
    client,
    refundId: "refund-deposit-webhook",
    status: "succeeded",
    metadata: { source: "cashfree_webhook_replay" },
  });

  assert.equal(first.length, 1);
  assert.equal(replay.length, 1);
  assert.equal(replay[0].status, "succeeded");
  assert.equal(replay[0].metadata.source, "cashfree_webhook_replay");
  assert.deepEqual(
    Array.from(client.classifications.values()).map((row) => row.accounting_category),
    [ACCOUNTING_CATEGORIES.RELIABILITY_DEPOSIT_REFUNDED]
  );
});

test("refund execution rejects provider refund ownership", () => {
  const plan = cancellationPlan();
  const invalid = {
    ...plan,
    refunds: [
      {
        ...plan.refunds[0],
        actorUserId: PROVIDER_ID,
        actorRole: "provider",
      },
    ],
  };

  assert.throws(() => validateRefundPlan(invalid), /Provider cannot be a refund recipient/);
});
