const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  deactivateProviderPayoutAccount,
  getProviderSettlementSummary,
  listProviderSettlementRecords,
  replaceProviderPayoutAccount,
  requestProviderPayoutAccountChange,
  approveProviderPayoutAccountChange,
  transitionProviderSettlementStatus,
  validatePayoutAccountInput,
  verifyProviderPayoutAccount,
  rejectProviderPayoutAccount,
} = require("../shared/services/providerPayout.service");
const {
  ACCOUNTING_CATEGORIES,
} = require("../shared/services/financialLedger.service");

const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createProviderFinanceClient() {
  const accounts = [];
  const ledger = new Map();
  const refundEvents = new Map();
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
        status: "failed",
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
    [
      "settlement_refunded",
      {
        id: "settlement_refunded",
        provider_id: PROVIDER_ID,
        reservation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        payment_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        payment_session_id: "session_refunded",
        settlement_allocation_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        amount: 950,
        commission_amount: 50,
        currency: "INR",
        status: "pending",
        paid_at: null,
        payment_reference: null,
        notes: null,
        processed_by: null,
        created_at: "2026-01-04T00:00:00.000Z",
        updated_at: "2026-01-04T00:00:00.000Z",
      },
    ],
  ]);
  refundEvents.set("ledger:refund:session_refunded", {
    id: "ledger_refund_1",
    reservation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    payment_session_id: "session_refunded",
    event_type: "refund_issued",
    amount: 1000,
    currency: "INR",
    created_at: "2026-01-04T00:00:00.000Z",
  });

  function hasRefundEvent(settlement) {
    return [...refundEvents.values(), ...ledger.values()].some(
      (entry) =>
        entry.event_type === "refund_issued" &&
        entry.reservation_id === settlement.reservation_id &&
        entry.payment_session_id === settlement.payment_session_id,
    );
  }

  return {
    accounts,
    ledger,
    classifications,
    settlements,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("UPDATE provider_payout_accounts")) {
        const updated = [];
        if (text.includes("SET is_active=false")) {
          const providerId = params[0];
          for (const account of accounts) {
            if (account.provider_id === providerId && account.is_active) {
              account.is_active = false;
              account.updated_at = `2026-01-0${accounts.length + 1}T00:00:00.000Z`;
              updated.push({ ...account });
            }
          }
        } else if (
          text.includes("change_request_status='pending'") &&
          !text.includes("change_request_status='replacement_pending'")
        ) {
          const payoutAccountId = params[0];
          const reason = params[1];
          const providerId = params[2];
          for (const account of accounts) {
            if (account.id === payoutAccountId && account.is_active) {
              account.change_request_status = "pending";
              account.change_request_reason = reason;
              account.change_requested_at = "2026-01-10T00:00:00.000Z";
              account.change_requested_by = providerId;
              account.change_reviewed_at = null;
              account.change_reviewed_by = null;
              account.change_review_notes = null;
              account.updated_at = "2026-01-10T00:00:00.000Z";
              updated.push({ ...account });
            }
          }
        } else if (text.includes("change_request_status='approved'")) {
          const payoutAccountId = params[0];
          const adminId = params[1];
          const notes = params[2];
          for (const account of accounts) {
            if (account.id === payoutAccountId && account.is_active) {
              account.change_request_status = "approved";
              account.change_reviewed_at = "2026-01-10T00:00:00.000Z";
              account.change_reviewed_by = adminId;
              account.change_review_notes = notes;
              account.updated_at = "2026-01-10T00:00:00.000Z";
              updated.push({ ...account });
            }
          }
        } else if (text.includes("change_request_status='replacement_pending'")) {
          const payoutAccountId = params[0];
          const adminId = params[1];
          const notes = params[2];
          for (const account of accounts) {
            if (account.id === payoutAccountId && account.is_active) {
              account.change_request_status = "replacement_pending";
              account.change_reviewed_at = "2026-01-10T00:00:00.000Z";
              account.change_reviewed_by = adminId;
              account.change_review_notes = notes;
              account.updated_at = "2026-01-10T00:00:00.000Z";
              updated.push({ ...account });
            }
          }
        } else if (text.includes("change_request_status='rejected'")) {
          const payoutAccountId = params[0];
          const adminId = params[1];
          const notes = params[2];
          for (const account of accounts) {
            if (account.id === payoutAccountId && account.is_active) {
              account.change_request_status = "rejected";
              account.change_reviewed_at = "2026-01-10T00:00:00.000Z";
              account.change_reviewed_by = adminId;
              account.change_review_notes = notes;
              account.updated_at = "2026-01-10T00:00:00.000Z";
              updated.push({ ...account });
            }
          }
        } else if (text.includes("verification_status='verified'")) {
          const payoutAccountId = params[0];
          const adminId = params[1];
          for (const account of accounts) {
            if (account.id === payoutAccountId && account.is_active) {
              account.verification_status = "verified";
              account.is_verified = true;
              account.verified_at = "2026-01-05T00:00:00.000Z";
              account.verified_by = adminId;
              account.rejection_reason = null;
              account.updated_at = "2026-01-05T00:00:00.000Z";
              updated.push({ ...account });
            }
          }
        } else if (text.includes("verification_status='rejected'")) {
          const payoutAccountId = params[0];
          const adminId = params[1];
          const reason = params[2];
          for (const account of accounts) {
            if (account.id === payoutAccountId && account.is_active) {
              account.verification_status = "rejected";
              account.is_verified = false;
              account.verified_at = null;
              account.verified_by = adminId;
              account.rejection_reason = reason;
              account.updated_at = "2026-01-05T00:00:00.000Z";
              updated.push({ ...account });
            }
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
          verification_status: "pending",
          verified_at: null,
          verified_by: null,
          rejection_reason: null,
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
        return {
          rows: [ledger.get(params[0])]
            .filter(Boolean)
            .map((row) => ({ ...row })),
        };
      }

      if (text.includes("WITH source_liability AS")) {
        const [reservationId, paymentSessionId] = params;
        const sourceRefundIds = new Set();
        let issuedAmount = 0;
        for (const entry of ledger.values()) {
          if (
            entry.event_type === "provider_refund_liability_issued" &&
            entry.reservation_id === reservationId &&
            entry.payment_session_id === paymentSessionId &&
            entry.refund_id
          ) {
            sourceRefundIds.add(entry.refund_id);
            issuedAmount += Number(entry.amount || 0);
          }
        }

        let releasedAmount = 0;
        for (const entry of ledger.values()) {
          if (
            entry.event_type === "provider_refund_liability_released" &&
            sourceRefundIds.has(entry.refund_id)
          ) {
            releasedAmount += Number(entry.amount || 0);
          }
        }

        return {
          rows: [
            {
              issued_amount: issuedAmount,
              released_amount: Math.min(releasedAmount, issuedAmount),
            },
          ],
        };
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

      if (text.includes("source_settlement.id AS source_settlement_id")) {
        const providerId = params[0];
        const grouped = new Map();
        for (const entry of ledger.values()) {
          if (
            !entry.refund_id ||
            ![
              "refund_issued",
              "provider_refund_liability_issued",
              "provider_refund_liability_released",
            ].includes(entry.event_type)
          ) {
            continue;
          }

          const source = Array.from(settlements.values()).find(
            (settlement) =>
              settlement.provider_id === providerId &&
              settlement.reservation_id === entry.reservation_id &&
              settlement.payment_session_id === entry.payment_session_id,
          );
          if (!source) continue;

          const key = `${entry.refund_id}:${source.id}`;
          const row = grouped.get(key) || {
            refund_id: entry.refund_id,
            source_settlement_id: source.id,
            source_carry_forward_amount: Number(
              source.manual_carry_forward_amount || 0,
            ),
            total_refund_amount: 0,
            liability_issued: 0,
            liability_released: 0,
          };
          if (entry.event_type === "refund_issued") {
            row.total_refund_amount += Number(entry.amount || 0);
          }
          if (entry.event_type === "provider_refund_liability_issued") {
            row.liability_issued += Number(entry.amount || 0);
          }
          if (entry.event_type === "provider_refund_liability_released") {
            row.liability_released += Number(entry.amount || 0);
          }
          grouped.set(key, row);
        }

        return {
          rows: Array.from(grouped.values()).filter(
            (row) =>
              Number(row.liability_issued || 0) >
                Number(row.liability_released || 0) ||
              Number(row.source_carry_forward_amount || 0) > 0,
          ),
        };
      }

      if (text.includes("FROM provider_payout_accounts")) {
        if (text.includes("WHERE id=$1")) {
          const payoutAccountId = params[0];
          return {
            rows: accounts
              .filter((account) => account.id === payoutAccountId)
              .map((account) => ({ ...account })),
          };
        }

        const providerId = params[0];
        return {
          rows: accounts
            .filter((account) => account.provider_id === providerId)
            .sort(
              (left, right) => Number(right.is_active) - Number(left.is_active),
            )
            .map((account) => ({ ...account })),
        };
      }

      if (text.includes("FOR UPDATE")) {
        return {
          rows: [settlements.get(params[0])]
            .filter(Boolean)
            .map((row) => ({ ...row })),
        };
      }

      if (
        text.includes("UPDATE provider_settlements") &&
        text.includes("manual_carry_forward_amount = GREATEST(manual_carry_forward_amount - $2")
      ) {
        const row = settlements.get(params[0]);
        if (!row) return { rows: [] };
        row.manual_carry_forward_amount = Math.max(
          Number(row.manual_carry_forward_amount || 0) - Number(params[1] || 0),
          0,
        );
        row.manual_carry_forward_applied_at =
          row.manual_carry_forward_amount === 0
            ? null
            : row.manual_carry_forward_applied_at || null;
        row.updated_at = "2026-01-04T00:00:00.000Z";
        return { rows: [{ ...row }] };
      }

      if (text.includes("UPDATE provider_settlements")) {
        const row = settlements.get(params[0]);
        if (!row) return { rows: [] };
        row.status = params[1];
        row.paid_amount = params[6];
        row.manual_carry_forward_amount = Math.max(
          Number(row.manual_carry_forward_amount || 0) - Number(params[7] || 0),
          0,
        );
        row.manual_carry_forward_applied_at =
          row.manual_carry_forward_amount === 0
            ? null
            : row.manual_carry_forward_applied_at || null;
        if (params[1] === "paid") {
          row.paid_at = params[2] || row.paid_at || "2026-01-04T00:00:00.000Z";
        }
        if (params[3]) row.payment_reference = params[3];
        if (params[4]) row.notes = params[4];
        row.processed_by = params[5];
        row.updated_at = "2026-01-04T00:00:00.000Z";
        return { rows: [{ ...row }] };
      }

      if (text.includes("WITH settlement_projection AS")) {
        const providerId = params[0];
        const pendingStatuses = params[1];
        const paidStatuses = params[2];
        let pending = 0;
        let paid = 0;
        let refunded = 0;
        let refundCount = 0;
        for (const row of settlements.values()) {
          if (row.provider_id !== providerId) continue;
          if (hasRefundEvent(row)) {
            refunded += Number(row.amount);
            refundCount++;
            continue;
          }
          if (pendingStatuses.includes(row.status)) {
            pending += Number(row.amount);
          }
          if (paidStatuses.includes(row.status)) paid += Number(row.amount);
        }
        return {
          rows: [
            {
              pending_earnings: pending,
              paid_earnings: paid,
              user_refunds: refunded,
              user_refund_count: refundCount,
            },
          ],
        };
      }

      if (text.includes("WITH monthly_source AS")) {
        const providerId = params[0];
        const pendingStatuses = params[1];
        const paidStatuses = params[2];
        return {
          rows: Array.from(settlements.values())
            .filter((row) => row.provider_id === providerId)
            .map((row) => {
              const refunded = hasRefundEvent(row);
              const amount = Number(row.amount);
              return {
                month_key: "2026-01",
                month_label: "Jan 2026",
                year: 2026,
                month: 1,
                earnings: refunded ? 0 : amount,
                paid: !refunded && paidStatuses.includes(row.status) ? amount : 0,
                pending:
                  !refunded && pendingStatuses.includes(row.status) ? amount : 0,
                refunded: refunded ? amount : 0,
                count: 1,
              };
            }),
        };
      }

      if (
        text.includes("SELECT COALESCE(SUM(paid_amount), 0)::numeric AS total_paid") &&
        text.includes("FROM provider_settlement_runs")
      ) {
        const providerId = params[0];
        const totalPaid = Array.from(settlements.values())
          .filter((row) => row.provider_id === providerId && row.status === "paid")
          .reduce(
            (sum, row) =>
              sum + Number(row.paid_amount ?? row.amount ?? 0),
            0,
          );
        return { rows: [{ total_paid: totalPaid }] };
      }

      if (text.includes("WITH provider_records AS")) {
        const providerId = params[0];
        const rows = Array.from(settlements.values())
          .filter((row) => row.provider_id === providerId)
          .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
          .map((row) => {
            let totalRefund = 0;
            for (const refund of refundEvents.values()) {
              if (
                refund.reservation_id === row.reservation_id &&
                refund.payment_session_id === row.payment_session_id &&
                refund.event_type === "refund_issued"
              ) {
                totalRefund += Number(refund.amount || 0);
              }
            }
            for (const ledgerEntry of ledger.values()) {
              if (
                ledgerEntry.reservation_id === row.reservation_id &&
                ledgerEntry.payment_session_id === row.payment_session_id &&
                ledgerEntry.event_type === "refund_issued"
              ) {
                totalRefund += Number(ledgerEntry.amount || 0);
              }
            }
            const refundAmount = Math.min(Number(row.amount || 0), totalRefund);
            return {
              record: {
                ...row,
                status:
                  refundAmount >= Number(row.amount || 0) &&
                  Number(row.amount || 0) > 0
                    ? "refunded"
                    : row.status,
                refund_amount: refundAmount,
              },
              total_count: settlements.size,
            };
          });

        return { rows };
      }

      if (
        text.includes("FROM provider_settlements") &&
        text.includes("ORDER BY COALESCE")
      ) {
        const providerId = params[0];
        return {
          rows: Array.from(settlements.values())
            .filter((row) => row.provider_id === providerId)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .map((row) => {
              // Calculate refund_amount like the real database query
              let totalRefund = 0;
              for (const refund of refundEvents.values()) {
                if (
                  refund.reservation_id === row.reservation_id &&
                  refund.payment_session_id === row.payment_session_id &&
                  refund.event_type === "refund_issued"
                ) {
                  totalRefund += Number(refund.amount || 0);
                }
              }
              for (const ledgerEntry of ledger.values()) {
                if (
                  ledgerEntry.reservation_id === row.reservation_id &&
                  ledgerEntry.payment_session_id === row.payment_session_id &&
                  ledgerEntry.event_type === "refund_issued"
                ) {
                  totalRefund += Number(ledgerEntry.amount || 0);
                }
              }
              // LEAST(settlement.amount, total_refund)
              const refundAmount = Math.min(Number(row.amount || 0), totalRefund);
              // Classify as "refunded" if refund_amount equals settlement amount
              const status = refundAmount >= Number(row.amount || 0) && Number(row.amount || 0) > 0 ? "refunded" : row.status;
              return {
                ...row,
                status,
                refund_amount: refundAmount,
              };
            }),
        };
      }

      // Handle refund liability queries
      if (text.includes("SELECT DISTINCT") && text.includes("fle.refund_id") && text.includes("GROUP BY fle.refund_id")) {
        // Query for refund_issued ledger entries
        const refundIds = new Set();
        for (const entry of ledger.values()) {
          if (
            entry.event_type === "refund_issued" &&
            entry.reservation_id === params[0] &&
            entry.payment_session_id === params[1] &&
            entry.refund_id
          ) {
            refundIds.add(entry.refund_id);
          }
        }
        return {
          rows: Array.from(refundIds).map((refundId) => {
            const amount = Array.from(ledger.values())
              .filter(
                (e) =>
                  e.event_type === "refund_issued" &&
                  e.refund_id === refundId &&
                  e.reservation_id === params[0] &&
                  e.payment_session_id === params[1],
              )
              .reduce((sum, e) => sum + Number(e.amount || 0), 0);
            return {
              refund_id: refundId,
              total_refund_amount: amount,
            };
          }),
        };
      }

      if (
        text.includes("SELECT") &&
        text.includes("CASE WHEN event_type = 'provider_refund_liability_issued'") &&
        text.includes("WHERE refund_id")
      ) {
        // Outstanding liability query
        const refundId = params[0];
        let issued = 0;
        let released = 0;
        for (const entry of ledger.values()) {
          if (entry.refund_id === refundId && entry.accounting_category === 'provider_refund_liability') {
            if (entry.event_type === "provider_refund_liability_issued") {
              issued += Number(entry.amount || 0);
            } else if (
              entry.event_type === "provider_refund_liability_released"
            ) {
              released += Number(entry.amount || 0);
            }
          }
        }
        return {
          rows: [
            {
              issued,
              released,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

async function addVerifiedPayoutAccount(client) {
  const account = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "settlement@upi" },
    ensureSchema: false,
  });
  await verifyProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });
  return account;
}

test("T-FIN-2 validates UPI and bank payout account inputs", () => {
  assert.deepEqual(
    validatePayoutAccountInput({
      account_type: "upi",
      upi_id: "Name@UPI",
    }),
    {
      account_type: "UPI",
      upi_id: "name@upi",
      account_holder_name: null,
      bank_account_number: null,
      ifsc_code: null,
    },
  );

  assert.equal(
    validatePayoutAccountInput({
      account_type: "BANK",
      account_holder_name: "Provider",
      bank_account_number: "1234567890",
      ifsc_code: "hdfc0123456",
    }).ifsc_code,
    "HDFC0123456",
  );
  assert.throws(
    () => validatePayoutAccountInput({ account_type: "UPI", upi_id: "bad" }),
    /UPI id/,
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
  assert.equal(
    client.accounts.filter((account) => account.is_active).length,
    1,
  );
  assert.equal(client.accounts[0].is_active, false);
  assert.equal(client.accounts[1].is_active, false);
});

test("T-FIN-2 manual settlement transitions are replay-safe updates", async () => {
  const client = createProviderFinanceClient();

  const account = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "valid@upi" },
    ensureSchema: false,
  });
  await verifyProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });

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
  assert.equal(
    Array.from(client.ledger.values())[0].event_type,
    "provider_settlement_paid",
  );
  assert.deepEqual(
    Array.from(client.classifications.values()).map(
      (row) => row.accounting_category,
    ),
    [ACCOUNTING_CATEGORIES.PROVIDER_SETTLEMENT_PAID],
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
    /Paid settlement/,
  );
});

test("T-FIN-2 original provider refund-liability source settlement cannot be paid", async () => {
  const client = createProviderFinanceClient();
  const source = {
    id: "source_refund_19",
    provider_id: PROVIDER_ID,
    reservation_id: "19191919-1919-4919-8919-191919191919",
    payment_id: "29292929-2929-4929-8929-292929292929",
    payment_session_id: "source_session_19",
    settlement_allocation_id: "39393939-3939-4939-8939-393939393939",
    amount: 19,
    paid_amount: 0,
    manual_carry_forward_amount: 0,
    commission_amount: 0,
    currency: "INR",
    status: "pending",
    paid_at: null,
    payment_reference: null,
    notes: null,
    processed_by: null,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };
  client.settlements.set(source.id, source);
  client.ledger.set("ledger:refund:source-19", {
    id: "ledger_refund_source_19",
    reservation_id: source.reservation_id,
    payment_session_id: source.payment_session_id,
    event_type: "refund_issued",
    amount: 45,
    currency: "INR",
    refund_id: "refund-source-19",
    accounting_category: ACCOUNTING_CATEGORIES.REFUND_EXPENSE,
  });
  client.ledger.set("ledger:liability:source-19", {
    id: "ledger_liability_source_19",
    reservation_id: source.reservation_id,
    payment_session_id: source.payment_session_id,
    event_type: "provider_refund_liability_issued",
    amount: 19,
    currency: "INR",
    refund_id: "refund-source-19",
    accounting_category: ACCOUNTING_CATEGORIES.PROVIDER_REFUND_LIABILITY,
  });

  await assert.rejects(
    () =>
      transitionProviderSettlementStatus({
        client,
        settlementId: source.id,
        status: "paid",
        adminId: ADMIN_ID,
        paymentReference: "blocked-source",
        ensureSchema: false,
      }),
    (error) => {
      assert.equal(error.code, "REFUND_LIABILITY_SOURCE_SETTLEMENT");
      assert.equal(error.statusCode, 409);
      return true;
    },
  );

  assert.equal(client.settlements.get(source.id).status, "pending");
  assert.equal(
    Array.from(client.ledger.values()).some(
      (entry) =>
        entry.event_type === "provider_settlement_paid" &&
        entry.provider_settlement_id === source.id,
    ),
    false,
  );
});

test("T-FIN-2 future settlement recovers source refund liability without paying source", async () => {
  const client = createProviderFinanceClient();
  await addVerifiedPayoutAccount(client);

  const source = {
    id: "source_refund_recovery_19",
    provider_id: PROVIDER_ID,
    reservation_id: "41414141-4141-4441-8441-414141414141",
    payment_id: "42424242-4242-4442-8442-424242424242",
    payment_session_id: "source_recovery_session_19",
    settlement_allocation_id: "43434343-4343-4443-8443-434343434343",
    amount: 19,
    paid_amount: 0,
    manual_carry_forward_amount: 19,
    manual_carry_forward_applied_at: "2026-02-02T00:00:00.000Z",
    commission_amount: 0,
    currency: "INR",
    status: "pending",
    paid_at: null,
    payment_reference: null,
    notes: null,
    processed_by: null,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-02T00:00:00.000Z",
  };
  const future = {
    id: "future_recovery_28_50",
    provider_id: PROVIDER_ID,
    reservation_id: "51515151-5151-4551-8551-515151515151",
    payment_id: "52525252-5252-4552-8552-525252525252",
    payment_session_id: "future_recovery_session_28_50",
    settlement_allocation_id: "53535353-5353-4553-8553-535353535353",
    amount: 28.5,
    paid_amount: 0,
    manual_carry_forward_amount: 0,
    commission_amount: 0,
    currency: "INR",
    status: "pending",
    paid_at: null,
    payment_reference: null,
    notes: null,
    processed_by: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
  client.settlements.set(source.id, source);
  client.settlements.set(future.id, future);
  client.ledger.set("ledger:refund:recovery-source-19", {
    id: "ledger_refund_recovery_source_19",
    reservation_id: source.reservation_id,
    payment_session_id: source.payment_session_id,
    event_type: "refund_issued",
    amount: 45,
    currency: "INR",
    refund_id: "refund-recovery-source-19",
    accounting_category: ACCOUNTING_CATEGORIES.REFUND_EXPENSE,
  });
  client.ledger.set("ledger:liability:recovery-source-19", {
    id: "ledger_liability_recovery_source_19",
    reservation_id: source.reservation_id,
    payment_session_id: source.payment_session_id,
    event_type: "provider_refund_liability_issued",
    amount: 19,
    currency: "INR",
    refund_id: "refund-recovery-source-19",
    accounting_category: ACCOUNTING_CATEGORIES.PROVIDER_REFUND_LIABILITY,
  });

  const paid = await transitionProviderSettlementStatus({
    client,
    settlementId: future.id,
    status: "paid",
    adminId: ADMIN_ID,
    paymentReference: "future-net-payment",
    paidAmount: 9.5,
    ensureSchema: false,
  });

  const release = Array.from(client.ledger.values()).find(
    (entry) =>
      entry.event_type === "provider_refund_liability_released" &&
      entry.provider_settlement_id === future.id,
  );

  assert.equal(paid.status, "paid");
  assert.equal(Number(client.settlements.get(future.id).paid_amount), 9.5);
  assert.equal(Number(release?.amount), 19);
  assert.equal(release?.refund_id, "refund-recovery-source-19");
  assert.equal(client.settlements.get(source.id).status, "pending");
  assert.equal(Number(client.settlements.get(source.id).manual_carry_forward_amount), 0);
  assert.equal(
    Array.from(client.ledger.values()).some(
      (entry) =>
        entry.event_type === "provider_settlement_paid" &&
        entry.provider_settlement_id === source.id,
    ),
    false,
  );

  await assert.rejects(
    () =>
      transitionProviderSettlementStatus({
        client,
        settlementId: source.id,
        status: "paid",
        adminId: ADMIN_ID,
        paymentReference: "blocked-after-release",
        ensureSchema: false,
      }),
    /Original provider refund-liability source settlement/,
  );
});

test("T-FIN-2 pending settlement with carry-forward and no source liability still pays", async () => {
  const client = createProviderFinanceClient();
  await addVerifiedPayoutAccount(client);
  const settlement = {
    id: "ordinary_carry_forward_target",
    provider_id: PROVIDER_ID,
    reservation_id: "61616161-6161-4661-8661-616161616161",
    payment_id: "62626262-6262-4662-8662-626262626262",
    payment_session_id: "ordinary_carry_forward_target_session",
    settlement_allocation_id: "63636363-6363-4663-8663-636363636363",
    amount: 40,
    paid_amount: 0,
    manual_carry_forward_amount: 10,
    manual_carry_forward_applied_at: "2026-04-01T00:00:00.000Z",
    commission_amount: 0,
    currency: "INR",
    status: "pending",
    paid_at: null,
    payment_reference: null,
    notes: null,
    processed_by: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
  client.settlements.set(settlement.id, settlement);

  const paid = await transitionProviderSettlementStatus({
    client,
    settlementId: settlement.id,
    status: "paid",
    adminId: ADMIN_ID,
    paymentReference: "ordinary-carry-forward",
    paidAmount: 30,
    ensureSchema: false,
  });

  assert.equal(paid.status, "paid");
  assert.equal(Number(client.settlements.get(settlement.id).paid_amount), 30);
  assert.equal(
    Number(client.settlements.get(settlement.id).manual_carry_forward_amount),
    0,
  );
  assert.equal(
    Array.from(client.ledger.values()).some(
      (entry) =>
        entry.event_type === "provider_settlement_paid" &&
        entry.provider_settlement_id === settlement.id,
    ),
    true,
  );
});

test("T-FIN-2 provider payout account verification updates status and metadata", async () => {
  const client = createProviderFinanceClient();

  const account = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "verify@upi" },
    ensureSchema: false,
  });

  const verified = await verifyProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });

  assert.equal(verified.verification_status, "verified");
  assert.equal(verified.is_verified, true);
  assert.equal(verified.verified_by, ADMIN_ID);
  assert.equal(verified.rejection_reason, null);

  const rejected = await rejectProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    reason: "Missing bank proof",
    ensureSchema: false,
  });

  assert.equal(rejected.verification_status, "rejected");
  assert.equal(rejected.is_verified, false);
  assert.equal(rejected.verified_by, ADMIN_ID);
  assert.equal(rejected.rejection_reason, "Missing bank proof");
});

test("T-FIN-2 payout account update resets verification status", async () => {
  const client = createProviderFinanceClient();

  const original = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "verified@upi" },
    ensureSchema: false,
  });

  await verifyProviderPayoutAccount({
    client,
    payoutAccountId: original.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });

  await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Update bank details",
    ensureSchema: false,
  });

  await approveProviderPayoutAccountChange({
    client,
    payoutAccountId: original.id,
    adminId: ADMIN_ID,
    reason: "Approved for replacement",
    ensureSchema: false,
  });

  const updated = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: {
      account_type: "BANK",
      account_holder_name: "Verified Provider",
      bank_account_number: "123456789012",
      ifsc_code: "HDFC0123456",
    },
    ensureSchema: false,
  });

  assert.equal(updated.verification_status, "pending");
  assert.equal(updated.is_verified, false);
  assert.equal(updated.verified_at, null);
  assert.equal(updated.verified_by, null);
  assert.equal(updated.rejection_reason, null);
  assert.equal(client.accounts.filter((row) => row.is_active).length, 1);
  assert.equal(
    client.accounts.filter((row) => row.is_active && row.id === original.id)
      .length,
    0,
  );
});

test("T-FIN-2 provider settlement earnings summary totals pending and paid", async () => {
  const client = createProviderFinanceClient();

  const summary = await getProviderSettlementSummary({
    client,
    providerId: PROVIDER_ID,
    limit: 50,
    ensureSchema: false,
  });

  assert.equal(summary.earnings.pending, 1250);
  assert.equal(summary.earnings.paid, 8430);
  assert.equal(summary.refunds.total, 0);
  assert.equal(summary.refunds.count, 0);
  assert.equal(summary.settlements.length, 1);
});


test("T-FIN-2 provider records include refunded settlement rows", async () => {
  const client = createProviderFinanceClient();

  const records = await listProviderSettlementRecords({
    client,
    providerId: PROVIDER_ID,
    year: 2026,
    month: 1,
    ensureSchema: false,
  });

  const refunded = records.records.find((row) => row.id === "settlement_refunded");
  assert.equal(refunded?.status, "refunded");
  assert.equal(refunded?.amount, 950);
});

test("T-FIN-2 failed settlement remains outstanding and does not reduce amount due or pending earnings", async () => {
  const client = createProviderFinanceClient();

  const before = await getProviderSettlementSummary({
    client,
    providerId: PROVIDER_ID,
    ensureSchema: false,
  });

  assert.equal(before.earnings.pending, 1250);
  assert.equal(before.earnings.paid, 8430);

  await transitionProviderSettlementStatus({
    client,
    settlementId: "settlement_pending",
    status: "failed",
    adminId: ADMIN_ID,
    notes: "Bank transfer failed",
    ensureSchema: false,
  });

  const after = await getProviderSettlementSummary({
    client,
    providerId: PROVIDER_ID,
    ensureSchema: false,
  });

  assert.equal(after.earnings.pending, 0);
  assert.equal(after.earnings.paid, 8430);
  assert.equal(after.settlements.length, 1);
  assert.equal(client.settlements.get("settlement_pending").status, "failed");
});

test("T-FIN-2 marking paid moves outstanding amount from pending to paid", async () => {
  const client = createProviderFinanceClient();

  const account = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "manual@upi" },
    ensureSchema: false,
  });

  await verifyProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });

  const before = await getProviderSettlementSummary({
    client,
    providerId: PROVIDER_ID,
    ensureSchema: false,
  });

  assert.equal(before.earnings.pending, 1250);
  assert.equal(before.earnings.paid, 8430);

  await transitionProviderSettlementStatus({
    client,
    settlementId: "settlement_pending",
    status: "paid",
    adminId: ADMIN_ID,
    paymentReference: "UTR123456",
    ensureSchema: false,
  });

  const after = await getProviderSettlementSummary({
    client,
    providerId: PROVIDER_ID,
    ensureSchema: false,
  });

  assert.equal(after.earnings.pending, 0);
  assert.equal(after.earnings.paid, 9680);
  assert.equal(client.settlements.get("settlement_pending").status, "paid");
});

test("T-FIN-2 marking paid requires a verified payout account", async () => {
  const client = createProviderFinanceClient();

  await assert.rejects(
    () =>
      transitionProviderSettlementStatus({
        client,
        settlementId: "settlement_pending",
        status: "paid",
        adminId: ADMIN_ID,
        paymentReference: "UTR123456",
        ensureSchema: false,
      }),
    /has not configured a payout account/,
  );

  const account = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "pending@upi" },
    ensureSchema: false,
  });

  await assert.rejects(
    () =>
      transitionProviderSettlementStatus({
        client,
        settlementId: "settlement_pending",
        status: "paid",
        adminId: ADMIN_ID,
        paymentReference: "UTR123456",
        ensureSchema: false,
      }),
    /verification is pending/,
  );

  await rejectProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    reason: "Invalid proof",
    ensureSchema: false,
  });

  await assert.rejects(
    () =>
      transitionProviderSettlementStatus({
        client,
        settlementId: "settlement_pending",
        status: "paid",
        adminId: ADMIN_ID,
        paymentReference: "UTR123456",
        ensureSchema: false,
      }),
    /has been rejected/,
  );

  await verifyProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });

  const paid = await transitionProviderSettlementStatus({
    client,
    settlementId: "settlement_pending",
    status: "paid",
    adminId: ADMIN_ID,
    paymentReference: "UTR123456",
    ensureSchema: false,
  });

  assert.equal(paid.status, "paid");
  assert.equal(paid.payment_reference, "UTR123456");
});

test("T-FIN-2 provider earnings reporting matches provider_settlements", async () => {
  const client = createProviderFinanceClient();

  const summary = await getProviderSettlementSummary({
    client,
    providerId: PROVIDER_ID,
    ensureSchema: false,
  });

  assert.equal(summary.earnings.pending, 1250);
  assert.equal(summary.earnings.paid, 8430);
  assert.equal(summary.settlements.length, 1);
});

test("T-FIN-2 migration declares payout accounts and manual settlement fields", () => {
  const migration = fs.readFileSync(
    path.resolve(
      __dirname,
      "../migrations/035_provider_payout_manual_settlements_tfin2.up.sql",
    ),
    "utf8",
  );
  const rollback = fs.readFileSync(
    path.resolve(
      __dirname,
      "../migrations/035_provider_payout_manual_settlements_tfin2.down.sql",
    ),
    "utf8",
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS provider_payout_accounts/,
  );
  assert.match(migration, /idx_provider_payout_accounts_one_active/);
  for (const column of [
    "paid_at",
    "payment_reference",
    "notes",
    "processed_by",
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    assert.match(rollback, new RegExp(`DROP COLUMN IF EXISTS ${column}`));
  }
  assert.match(
    migration,
    /status IN \('pending','processing','paid','failed','cancelled'\)/,
  );
});
