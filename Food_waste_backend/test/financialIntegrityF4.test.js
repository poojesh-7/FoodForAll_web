const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildSettlementAllocationSnapshot,
  getPlatformCommissionPercent,
  recordFinancialOperationLedgerStatus,
  recordSettlementAllocation,
} = require("../shared/services/financialLedger.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NGO_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const RESERVATION_ID = "55555555-5555-4555-8555-555555555555";
const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";
const OWNERSHIP_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "session_f4";

function ownership(overrides = {}) {
  const payerId = overrides.payer_user_id || USER_ID;
  const payerRole = overrides.payer_role || "user";

  return {
    id: OWNERSHIP_ID,
    reservation_id: RESERVATION_ID,
    payment_session_id: SESSION_ID,
    payer_user_id: payerId,
    payer_role: payerRole,
    provider_id: PROVIDER_ID,
    food_amount: 100,
    deposit_amount: 20,
    commission_amount: 0,
    currency: "INR",
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: PAYMENT_ID,
    reservation_id: RESERVATION_ID,
    payment_session_id: SESSION_ID,
    order_id: "order_f4",
    amount: 120,
    food_amount: 100,
    reliability_deposit_amount: 20,
    status: "paid",
    ...overrides,
  };
}

function operation(overrides = {}) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    operation_type: "deposit_refund",
    operation_source: "successful_pickup",
    reservation_id: RESERVATION_ID,
    payment_session_id: SESSION_ID,
    payment_ownership_id: OWNERSHIP_ID,
    actor_user_id: USER_ID,
    actor_role: "user",
    amount: 20,
    currency: "INR",
    retry_count: 0,
    metadata: { refund_id: "refund_f4" },
    ...overrides,
  };
}

function createLedgerClient(seedOwnership = ownership()) {
  const allocations = new Map();
  const providerSettlements = new Map();
  const ledger = new Map();
  const terminal = new Map();

  return {
    allocations,
    providerSettlements,
    ledger,
    terminal,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("FROM payment_ownership")) {
        return { rows: seedOwnership ? [seedOwnership] : [] };
      }

      if (text.includes("INSERT INTO settlement_allocation_snapshots")) {
        const key = params[14];
        if (allocations.has(key)) return { rows: [] };
        const row = {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reservation_id: params[0],
          payment_id: params[1],
          payment_session_id: params[2],
          payment_ownership_id: params[3],
          commission_percent: params[4],
          commission_amount: params[5],
          provider_amount: params[6],
          platform_amount: params[7],
          deposit_amount: params[8],
          tax_amount: params[9],
          food_amount: params[10],
          total_amount: params[11],
          currency: params[12],
          settlement_version: params[13],
          idempotency_key: key,
          metadata: JSON.parse(params[15]),
        };
        allocations.set(key, row);
        return { rows: [row] };
      }

      if (text.includes("FROM settlement_allocation_snapshots")) {
        return { rows: [allocations.get(params[0])].filter(Boolean) };
      }

      if (text.includes("INSERT INTO provider_settlements")) {
        const key = params[8];
        if (providerSettlements.has(key)) return { rows: [] };
        const row = {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          provider_id: params[0],
          reservation_id: params[1],
          payment_id: params[2],
          payment_session_id: params[3],
          settlement_allocation_id: params[4],
          amount: params[5],
          commission_amount: params[6],
          currency: params[7],
          idempotency_key: key,
        };
        providerSettlements.set(key, row);
        return { rows: [row] };
      }

      if (text.includes("FROM provider_settlements")) {
        return { rows: [providerSettlements.get(params[0])].filter(Boolean) };
      }

      if (text.includes("INSERT INTO financial_ledger_entries")) {
        const key = params[17];
        if (ledger.has(key)) return { rows: [] };
        const row = {
          event_type: params[7],
          amount: params[8],
          refund_id: params[14],
          idempotency_key: key,
        };
        ledger.set(key, row);
        return { rows: [row] };
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

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F4 allocation snapshots freeze configured commission at transaction time", () => {
  const previous = process.env.PLATFORM_COMMISSION_PERCENT;
  process.env.PLATFORM_COMMISSION_PERCENT = "5";
  const first = buildSettlementAllocationSnapshot({
    payment: payment(),
    paymentOwnership: ownership(),
  });

  process.env.PLATFORM_COMMISSION_PERCENT = "8";
  const second = buildSettlementAllocationSnapshot({
    payment: payment(),
    paymentOwnership: ownership(),
  });

  assert.equal(getPlatformCommissionPercent(), 8);
  assert.equal(first.commission_percent, 5);
  assert.equal(first.commission_amount, 5);
  assert.equal(first.provider_amount, 95);
  assert.equal(second.commission_percent, 8);
  assert.equal(second.commission_amount, 8);
  assert.equal(second.provider_amount, 92);
  assert.equal(first.settlement_version, 1);

  if (previous === undefined) delete process.env.PLATFORM_COMMISSION_PERCENT;
  else process.env.PLATFORM_COMMISSION_PERCENT = previous;
});

test("F4 user successful pickup creates payment, commission, deposit, and settlement ledger entries", async () => {
  const client = createLedgerClient();
  await recordSettlementAllocation({ client, payment: payment() });
  await recordSettlementAllocation({ client, payment: payment() });

  const events = Array.from(client.ledger.values()).map((row) => row.event_type).sort();
  assert.deepEqual(events, [
    "deposit_collected",
    "food_payment_settled",
    "payment_collected",
    "platform_commission",
    "settlement_allocated",
  ]);
  assert.equal(client.allocations.size, 1);
  assert.equal(client.providerSettlements.size, 1);
});

test("F4 user cancellation emits one terminal payment refund across duplicate replay", async () => {
  const client = createLedgerClient();
  await recordFinancialOperationLedgerStatus({
    client,
    operation: operation({
      operation_type: "payment_refund",
      operation_source: "user_cancelled",
      amount: 120,
    }),
    status: "succeeded",
    refundId: "refund_cancel",
  });
  await recordFinancialOperationLedgerStatus({
    client,
    operation: operation({
      operation_type: "payment_refund",
      operation_source: "user_cancelled",
      amount: 120,
    }),
    status: "succeeded",
    refundId: "refund_cancel",
  });

  assert.equal(client.ledger.size, 1);
  assert.equal(Array.from(client.ledger.values())[0].event_type, "refund_issued");
  assert.equal(client.terminal.size, 1);
});

test("F4 user failed pickup and NGO deposit retention emit deposit_retained", async () => {
  for (const actor of [
    { role: "user", userId: USER_ID, source: "user_failed_pickup" },
    { role: "platform", userId: null, source: "volunteer_delivery_failed" },
  ]) {
    const client = createLedgerClient();
    await recordFinancialOperationLedgerStatus({
      client,
      operation: operation({
        operation_type: "deposit_retention",
        operation_source: actor.source,
        actor_role: actor.role,
        actor_user_id: actor.userId,
        amount: 20,
      }),
      status: "retained",
    });

    assert.equal(Array.from(client.ledger.values())[0].event_type, "deposit_retained");
    assert.equal(Array.from(client.terminal.values())[0].terminal_status, "retained");
  }
});

test("F4 NGO successful delivery and deposit refund emit deposit_refunded", async () => {
  const client = createLedgerClient(ownership({
    payer_user_id: NGO_ID,
    payer_role: "ngo",
    food_amount: 0,
    deposit_amount: 50,
  }));

  await recordFinancialOperationLedgerStatus({
    client,
    operation: operation({
      operation_type: "deposit_refund",
      operation_source: "successful_delivery",
      actor_user_id: NGO_ID,
      actor_role: "ngo",
      amount: 50,
    }),
    status: "succeeded",
    refundId: "refund_ngo_deposit",
  });

  const row = Array.from(client.ledger.values())[0];
  assert.equal(row.event_type, "deposit_refunded");
  assert.equal(row.amount, 50);
  assert.equal(client.terminal.size, 1);
});

test("F4 refund and reconciliation replays record failed and retried states idempotently", async () => {
  const client = createLedgerClient();
  await recordFinancialOperationLedgerStatus({
    client,
    operation: operation({ operation_type: "payment_refund", amount: 120 }),
    status: "failed",
    refundId: "refund_failed",
  });
  await recordFinancialOperationLedgerStatus({
    client,
    operation: operation({
      operation_type: "payment_refund",
      amount: 120,
      retry_count: 1,
    }),
    status: "processing",
    refundId: "refund_failed",
  });
  await recordFinancialOperationLedgerStatus({
    client,
    operation: operation({
      operation_type: "payment_refund",
      amount: 120,
      retry_count: 1,
    }),
    status: "processing",
    refundId: "refund_failed",
  });

  const events = Array.from(client.ledger.values()).map((row) => row.event_type).sort();
  assert.deepEqual(events, ["refund_failed", "refund_retried"]);
});

test("F4 migration and schema declare immutable ledger and settlement readiness structures", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../migrations/013_financial_settlement_accounting_f4.up.sql"),
    "utf8"
  );
  const schema = fs.readFileSync(path.resolve(__dirname, "../../schema.sql"), "utf8");

  for (const table of [
    "financial_ledger_entries",
    "settlement_allocation_snapshots",
    "provider_settlements",
    "settlement_batches",
    "financial_refund_terminal_records",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(schema, new RegExp(table));
  }

  assert.match(migration, /prevent_financial_ledger_mutation/);
  assert.match(migration, /idx_financial_refund_terminal_once/);
  assert.match(migration, /idx_financial_ledger_entries_idempotency_key/);
});
