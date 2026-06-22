const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  deactivateProviderPayoutAccount,
  getProviderSettlementSummary,
  replaceProviderPayoutAccount,
  transitionProviderSettlementStatus,
  validatePayoutAccountInput,
} = require("../shared/services/providerPayout.service");
const {
  ACCOUNTING_CATEGORIES,
} = require("../shared/services/financialLedger.service");

const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createProviderFinanceClient() {
  const accounts = [];
  const ledger = new Map();
  const classifications = new Map();
  const settlements = new Map([
    [
      "settlement_pending",
      {
        id: "settlement_pending",
        provider_id: PROVIDER_ID,
        reservation_id: "55555555-5555-4555-8555-555555555555",
        payment_id: "77777777-7777-4777-8777-777777777777",
        payment_session_id: "session_pending",
        settlement_allocation_id: "11111111-1111-4111-8111-111111111111",
        amount: 1250,
        commission_amount: 50,
        currency: "INR",
        status: "pending",
        paid_at: null,
        payment_reference: null,
        notes: null,
        processed_by: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    [
      "settlement_failed",
      {
        id: "settlement_failed",
        provider_id: PROVIDER_ID,
        reservation_id: "66666666-6666-4666-8666-666666666666",
        payment_id: "88888888-8888-4888-8888-888888888888",
        payment_session_id: "session_failed",
        settlement_allocation_id: "22222222-2222-4222-8222-222222222222",
        amount: 400,
        commission_amount: 20,
        currency: "INR",
        status: "pending",
        paid_at: null,
        payment_reference: null,
        notes: null,
        processed_by: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ],
    [
      "settlement_paid",
      {
        id: "settlement_paid",
        provider_id: PROVIDER_ID,
        reservation_id: "99999999-9999-4999-8999-999999999999",
        payment_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        payment_session_id: "session_paid",
        settlement_allocation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        amount: 8430,
        commission_amount: 300,
        currency: "INR",
        status: "paid",
        paid_at: "2026-01-03T00:00:00.000Z",
        payment_reference: "UTRPAID",
        notes: null,
        processed_by: ADMIN_ID,
        created_at: "2026-01-03T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      },
    ],
  ]);

  return {
    accounts,
    ledger,
    classifications,
    settlements,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("UPDATE provider_payout_accounts")) {
        const providerId = params[0];
        const updated = [];
        for (const account of accounts) {
          if (account.provider_id === providerId && account.is_active) {
            account.is_active = false;
            account.updated_at = `2026-01-0${accounts.length + 1}T00:00:00.000Z`;
            updated.push({ ...account });
          }
        }
        return text.includes("RETURNING *")
          ? { rowCount: updated.length, rows: updated }
          : { rowCount: updated.length, rows: [] };
      }

      if (text.includes("INSERT INTO provider_payout_accounts")) {
        const row = {
          id: `account_${accounts.length + 1}`,
          provider_id: params[0],
          account_type: params[1],
          upi_id: params[2],
          account_holder_name: params[3],
          bank_account_number: params[4],
          ifsc_code: params[5],
          is_active: true,
          is_verified: false,
          created_at: `2026-01-0${accounts.length + 1}T00:00:00.000Z`,
          updated_at: `2026-01-0${accounts.length + 1}T00:00:00.000Z`,
        };
        accounts.push(row);
        return { rows: [{ ...row }] };
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

      if (text.includes("FROM provider_payout_accounts")) {
        const providerId = params[0];
        return {
          rows: accounts
            .filter((account) => account.provider_id === providerId)
            .sort((left, right) => Number(right.is_active) - Number(left.is_active))
            .map((account) => ({ ...account })),
        };
      }

      if (text.includes("FOR UPDATE")) {
        return { rows: [settlements.get(params[0])].filter(Boolean).map((row) => ({ ...row })) };
      }

      if (text.includes("UPDATE provider_settlements")) {
        const row = settlements.get(params[0]);
        if (!row) return { rows: [] };
        row.status = params[1];
        if (params[1] === "paid") {
          row.paid_at = params[2] || row.paid_at || "2026-01-04T00:00:00.000Z";
        }
        if (params[3]) row.payment_reference = params[3];
        if (params[4]) row.notes = params[4];
        row.processed_by = params[5];
        row.updated_at = "2026-01-04T00:00:00.000Z";
        return { rows: [{ ...row }] };
      }

      if (text.includes("COALESCE(SUM(amount) FILTER")) {
        const providerId = params[0];
        const pendingStatuses = params[1];
        const paidStatuses = params[2];
        let pending = 0;
        let paid = 0;
        for (const row of settlements.values()) {
          if (row.provider_id !== providerId) continue;
          if (pendingStatuses.includes(row.status)) pending += Number(row.amount);
          if (paidStatuses.includes(row.status)) paid += Number(row.amount);
        }
        return {
          rows: [
            {
              pending_earnings: pending,
              paid_earnings: paid,
            },
          ],
        };
      }

      if (
        text.includes("FROM provider_settlements") &&
        text.includes("ORDER BY COALESCE")
      ) {
        const providerId = params[0];
        return {
          rows: Array.from(settlements.values())
            .filter((row) => row.provider_id === providerId)
            .map((row) => ({ ...row })),
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("T-FIN-2 validates UPI and bank payout account inputs", () => {
  assert.deepEqual(validatePayoutAccountInput({
    account_type: "upi",
    upi_id: "Name@UPI",
  }), {
    account_type: "UPI",
    upi_id: "name@upi",
    account_holder_name: null,
    bank_account_number: null,
    ifsc_code: null,
  });

  assert.equal(
    validatePayoutAccountInput({
      account_type: "BANK",
      account_holder_name: "Provider",
      bank_account_number: "1234567890",
      ifsc_code: "hdfc0123456",
    }).ifsc_code,
    "HDFC0123456"
  );
  assert.throws(
    () => validatePayoutAccountInput({ account_type: "UPI", upi_id: "bad" }),
    /UPI id/
  );
});

test("T-FIN-2 provider payout account replacement keeps history", async () => {
  const client = createProviderFinanceClient();

  const first = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "first@upi" },
    ensureSchema: false,
  });
  const second = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "second@upi" },
    ensureSchema: false,
  });
  const deactivated = await deactivateProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    ensureSchema: false,
  });
  const bank = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: {
      account_type: "BANK",
      account_holder_name: "Provider Owner",
      bank_account_number: "123456789012",
      ifsc_code: "HDFC0123456",
    },
    ensureSchema: false,
  });

  assert.equal(first.is_active, true);
  assert.equal(second.is_active, true);
  assert.equal(deactivated.is_active, false);
  assert.equal(bank.account_type, "BANK");
  assert.equal(client.accounts.length, 3);
  assert.equal(client.accounts.filter((account) => account.is_active).length, 1);
  assert.equal(client.accounts[0].is_active, false);
  assert.equal(client.accounts[1].is_active, false);
});

test("T-FIN-2 manual settlement transitions are replay-safe updates", async () => {
  const client = createProviderFinanceClient();

  const paid = await transitionProviderSettlementStatus({
    client,
    settlementId: "settlement_pending",
    status: "paid",
    adminId: ADMIN_ID,
    paymentReference: "UTR123456",
    notes: "Manual UPI transfer",
    ensureSchema: false,
  });
  const replay = await transitionProviderSettlementStatus({
    client,
    settlementId: "settlement_pending",
    status: "paid",
    adminId: ADMIN_ID,
    paymentReference: "UTR123456",
    ensureSchema: false,
  });
  const failed = await transitionProviderSettlementStatus({
    client,
    settlementId: "settlement_failed",
    status: "failed",
    adminId: ADMIN_ID,
    notes: "Bank transfer failed",
    ensureSchema: false,
  });

  assert.equal(paid.status, "paid");
  assert.equal(paid.payment_reference, "UTR123456");
  assert.equal(replay.id, paid.id);
  assert.equal(failed.status, "failed");
  assert.equal(client.ledger.size, 1);
  assert.equal(Array.from(client.ledger.values())[0].event_type, "provider_settlement_paid");
  assert.deepEqual(
    Array.from(client.classifications.values()).map((row) => row.accounting_category),
    [ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_PAID]
  );
  await assert.rejects(
    () =>
      transitionProviderSettlementStatus({
        client,
        settlementId: "settlement_paid",
        status: "failed",
        adminId: ADMIN_ID,
        ensureSchema: false,
      }),
    /Paid settlement/
  );
});

test("T-FIN-2 provider earnings reporting matches provider_settlements", async () => {
  const client = createProviderFinanceClient();

  const summary = await getProviderSettlementSummary({
    client,
    providerId: PROVIDER_ID,
    ensureSchema: false,
  });

  assert.equal(summary.earnings.pending, 1650);
  assert.equal(summary.earnings.paid, 8430);
  assert.equal(summary.settlements.length, 3);
});

test("T-FIN-2 migration declares payout accounts and manual settlement fields", () => {
  const migration = fs.readFileSync(
    path.resolve(
      __dirname,
      "../migrations/035_provider_payout_manual_settlements_tfin2.up.sql"
    ),
    "utf8"
  );
  const rollback = fs.readFileSync(
    path.resolve(
      __dirname,
      "../migrations/035_provider_payout_manual_settlements_tfin2.down.sql"
    ),
    "utf8"
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS provider_payout_accounts/);
  assert.match(migration, /idx_provider_payout_accounts_one_active/);
  for (const column of ["paid_at", "payment_reference", "notes", "processed_by"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    assert.match(rollback, new RegExp(`DROP COLUMN IF EXISTS ${column}`));
  }
  assert.match(migration, /status IN \('pending','processing','paid','failed','cancelled'\)/);
});
