const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const observabilityServicePath = path.resolve(
  __dirname,
  "../shared/services/observability.service.js",
);
const payoutServicePath = path.resolve(
  __dirname,
  "../shared/services/providerPayout.service.js",
);

const observabilityService = require(observabilityServicePath);
const originalRecordOperationalEvent =
  observabilityService.recordOperationalEvent;
let capturedOperationalEvents = [];
observabilityService.recordOperationalEvent = async (event) => {
  capturedOperationalEvents.push(event);
};

delete require.cache[require.resolve(payoutServicePath)];
const {
  listProviderPayoutAccounts,
  requestProviderPayoutAccountChange,
  approveProviderPayoutAccountChange,
  rejectProviderPayoutAccountChange,
  replaceProviderPayoutAccount,
  verifyProviderPayoutAccount,
  transitionProviderSettlementStatus,
} = require(payoutServicePath);

test.after(() => {
  observabilityService.recordOperationalEvent = originalRecordOperationalEvent;
});

function createProviderFinanceClient() {
  const accounts = [];
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
  ]);

  return {
    accounts,
    settlements,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("INSERT INTO provider_payout_accounts")) {
        const row = {
          id: `account_${accounts.length + 1}`,
          provider_id: params[0],
          account_type: params[1],
          upi_id: params[2] || null,
          account_holder_name: params[3] || null,
          bank_account_number: params[4] || null,
          ifsc_code: params[5] || null,
          is_active: true,
          is_verified: false,
          verification_status: "pending",
          verified_at: null,
          verified_by: null,
          rejection_reason: null,
          change_request_status: null,
          change_request_reason: null,
          change_requested_at: null,
          change_requested_by: null,
          change_reviewed_at: null,
          change_reviewed_by: null,
          change_review_notes: null,
          created_at: `2026-01-0${accounts.length + 1}T00:00:00.000Z`,
          updated_at: `2026-01-0${accounts.length + 1}T00:00:00.000Z`,
        };
        accounts.push(row);
        return { rows: [{ ...row }] };
      }

      if (text.includes("UPDATE provider_payout_accounts")) {
        const updatedRows = [];

        if (text.includes("SET is_active=false")) {
          const providerId = params[0];
          for (const account of accounts) {
            if (account.provider_id === providerId && account.is_active) {
              account.is_active = false;
              account.updated_at = "2026-01-10T00:00:00.000Z";
              updatedRows.push({ ...account });
            }
          }
          return { rowCount: updatedRows.length, rows: updatedRows };
        }

        if (text.includes("change_request_status='pending'")) {
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
              updatedRows.push({ ...account });
            }
          }
          return { rowCount: updatedRows.length, rows: updatedRows };
        }

        if (text.includes("change_request_status='approved'")) {
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
              updatedRows.push({ ...account });
            }
          }
          return { rowCount: updatedRows.length, rows: updatedRows };
        }

        if (text.includes("change_request_status='replacement_pending'")) {
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
              updatedRows.push({ ...account });
            }
          }
          return { rowCount: updatedRows.length, rows: updatedRows };
        }

        if (text.includes("change_request_status='rejected'")) {
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
              updatedRows.push({ ...account });
            }
          }
          return { rowCount: updatedRows.length, rows: updatedRows };
        }

        if (text.includes("verification_status='verified'")) {
          const payoutAccountId = params[0];
          const adminId = params[1];
          for (const account of accounts) {
            if (account.id === payoutAccountId && account.is_active) {
              account.verification_status = "verified";
              account.is_verified = true;
              account.verified_at = "2026-01-10T00:00:00.000Z";
              account.verified_by = adminId;
              account.rejection_reason = null;
              account.updated_at = "2026-01-10T00:00:00.000Z";
              updatedRows.push({ ...account });
            }
          }
          return { rowCount: updatedRows.length, rows: updatedRows };
        }

        if (text.includes("verification_status='rejected'")) {
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
              account.updated_at = "2026-01-10T00:00:00.000Z";
              updatedRows.push({ ...account });
            }
          }
          return { rowCount: updatedRows.length, rows: updatedRows };
        }
      }

      if (text.includes("FROM provider_payout_accounts")) {
        if (text.includes("LIMIT 1") && !text.includes("change_request_status")) {
          throw new Error(
            "loadActiveProviderPayoutAccount must select change_request_status for replacement upload guard",
          );
        }

        let rows = accounts.map((account) => ({ ...account }));
        if (text.includes("WHERE id=$1")) {
          const accountId = params[0];
          rows = rows.filter((account) => account.id === accountId);
        } else {
          const providerId = params[0];
          rows = rows.filter((account) => account.provider_id === providerId);
        }

        rows.sort((left, right) => {
          if (left.is_active !== right.is_active) {
            return Number(right.is_active) - Number(left.is_active);
          }
          if (left.created_at !== right.created_at) {
            return left.created_at < right.created_at ? 1 : -1;
          }
          return left.id < right.id ? 1 : -1;
        });

        if (text.includes("LIMIT 1")) {
          return { rows: rows.slice(0, 1) };
        }

        return { rows };
      }

      if (text.includes("FOR UPDATE")) {
        const settlement = settlements.get(params[0]);
        return { rows: settlement ? [{ ...settlement }] : [] };
      }

      if (text.includes("UPDATE provider_settlements")) {
        const settlementId = params[0];
        const row = settlements.get(settlementId);
        if (!row) return { rows: [] };
        row.status = params[1];
        if (params[1] === "paid") {
          row.paid_at = params[2] || row.paid_at || "2026-01-10T00:00:00.000Z";
        }
        if (params[3]) row.payment_reference = params[3];
        if (params[4]) row.notes = params[4];
        row.processed_by = params[5];
        row.updated_at = "2026-01-10T00:00:00.000Z";
        return { rows: [{ ...row }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

async function createVerifiedPayoutAccount(client) {
  const account = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "verified@upi" },
    ensureSchema: false,
  });

  return verifyProviderPayoutAccount({
    client,
    payoutAccountId: account.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });
}

function assertPayoutAccountHistory(client, expectedActiveCount) {
  const activeAccounts = client.accounts.filter((account) => account.is_active);
  assert.equal(activeAccounts.length, expectedActiveCount);
}

test("T-FIN-2.4 verified provider cannot directly replace account", async () => {
  const client = createProviderFinanceClient();
  const verified = await createVerifiedPayoutAccount(client);

  await assert.rejects(
    () =>
      replaceProviderPayoutAccount({
        client,
        providerId: PROVIDER_ID,
        payload: { account_type: "UPI", upi_id: "replacement@upi" },
        ensureSchema: false,
      }),
    /PAYOUT_ACCOUNT_CHANGE_REQUEST_REQUIRED|Change request must be approved before replacing a verified payout account\./,
  );

  assert.equal(verified.is_active, true);
  assert.equal(verified.verification_status, "verified");
  assert.equal(verified.is_verified, true);
  assert.equal(verified.change_request_status, null);
  assertPayoutAccountHistory(client, 1);
});

test("T-FIN-2.4 provider creates payout account change request", async () => {
  const client = createProviderFinanceClient();
  const verified = await createVerifiedPayoutAccount(client);

  const requested = await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Need to update UPI ID",
    ensureSchema: false,
  });

  assert.equal(requested.change_request_status, "pending");
  assert.equal(requested.change_request_reason, "Need to update UPI ID");
  assert.equal(requested.is_active, true);
  assert.equal(requested.verification_status, "verified");
  assert.equal(requested.is_verified, true);
  assert.equal(verified.change_request_status, null);
  assertPayoutAccountHistory(client, 1);
});

test("T-FIN-2.4 admin rejects payout account change request", async () => {
  const client = createProviderFinanceClient();
  const verified = await createVerifiedPayoutAccount(client);
  const requested = await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Wrong UPI name",
    ensureSchema: false,
  });

  const rejected = await rejectProviderPayoutAccountChange({
    client,
    payoutAccountId: requested.id,
    adminId: ADMIN_ID,
    reason: "Incomplete documentation",
    ensureSchema: false,
  });

  assert.equal(rejected.change_request_status, "rejected");
  assert.equal(rejected.change_review_notes, "Incomplete documentation");
  assert.equal(rejected.is_active, true);
  assert.equal(rejected.verification_status, "verified");
  assert.equal(rejected.is_verified, true);
  await assert.rejects(
    () =>
      replaceProviderPayoutAccount({
        client,
        providerId: PROVIDER_ID,
        payload: { account_type: "UPI", upi_id: "replacement@upi" },
        ensureSchema: false,
      }),
    /PAYOUT_ACCOUNT_CHANGE_REQUEST_REQUIRED|Change request must be approved before replacing a verified payout account\./,
  );
  assertPayoutAccountHistory(client, 1);
});

test("T-FIN-2.4 admin approves payout account change request", async () => {
  const client = createProviderFinanceClient();
  const verified = await createVerifiedPayoutAccount(client);
  const requested = await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Update bank details",
    ensureSchema: false,
  });

  const approved = await approveProviderPayoutAccountChange({
    client,
    payoutAccountId: requested.id,
    adminId: ADMIN_ID,
    reason: "Approved for update",
    ensureSchema: false,
  });

  assert.equal(approved.change_request_status, "replacement_pending");
  assert.equal(approved.change_review_notes, "Approved for update");
  assert.equal(approved.is_active, true);
  assert.equal(approved.verification_status, "verified");
  assert.equal(approved.is_verified, true);

  const replacement = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "new@upi" },
    ensureSchema: false,
  });

  assert.equal(replacement.verification_status, "pending");
  assert.equal(replacement.is_verified, false);
  assert.equal(replacement.verified_at, null);
  assert.equal(replacement.verified_by, null);
  assert.equal(replacement.rejection_reason, null);
  assert.equal(replacement.is_active, true);
  assertPayoutAccountHistory(client, 1);
});

test("T-FIN-2.4 replacement upload after approval creates pending payout account", async () => {
  const client = createProviderFinanceClient();
  await createVerifiedPayoutAccount(client);
  const requested = await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Switch UPI provider",
    ensureSchema: false,
  });

  await approveProviderPayoutAccountChange({
    client,
    payoutAccountId: requested.id,
    adminId: ADMIN_ID,
    reason: "Approved",
    ensureSchema: false,
  });

  const replacement = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "replacement@upi" },
    ensureSchema: false,
  });

  assert.equal(replacement.is_active, true);
  assert.equal(replacement.verification_status, "pending");
  assert.equal(replacement.verified_at, null);
  assert.equal(replacement.verified_by, null);
  assert.equal(replacement.rejection_reason, null);
});

test("T-FIN-2.4 re-verification flow restores payout status", async () => {
  const client = createProviderFinanceClient();
  await createVerifiedPayoutAccount(client);
  const requested = await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Update UPI account",
    ensureSchema: false,
  });
  await approveProviderPayoutAccountChange({
    client,
    payoutAccountId: requested.id,
    adminId: ADMIN_ID,
    reason: "Approved",
    ensureSchema: false,
  });

  const replacement = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "reverify@upi" },
    ensureSchema: false,
  });

  const verified = await verifyProviderPayoutAccount({
    client,
    payoutAccountId: replacement.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });

  assert.equal(verified.verification_status, "verified");
  assert.equal(verified.verified_at, "2026-01-10T00:00:00.000Z");
  assert.equal(verified.verified_by, ADMIN_ID);
  assert.equal(verified.is_verified, true);
});

test("T-FIN-2.4 settlement protection blocks paid marking during pending replacement", async () => {
  const client = createProviderFinanceClient();
  await createVerifiedPayoutAccount(client);
  const requested = await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Bank update",
    ensureSchema: false,
  });
  await approveProviderPayoutAccountChange({
    client,
    payoutAccountId: requested.id,
    adminId: ADMIN_ID,
    reason: "Approved",
    ensureSchema: false,
  });
  await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "pending-settlement@upi" },
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
});

test("T-FIN-2.4 audit events are recorded for payout change workflow", async () => {
  capturedOperationalEvents = [];
  const client = createProviderFinanceClient();
  await createVerifiedPayoutAccount(client);

  const requested = await requestProviderPayoutAccountChange({
    client,
    providerId: PROVIDER_ID,
    reason: "Audit event test",
    ensureSchema: false,
  });

  await approveProviderPayoutAccountChange({
    client,
    payoutAccountId: requested.id,
    adminId: ADMIN_ID,
    reason: "Approve audit",
    ensureSchema: false,
  });

  const replacement = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "audit@upi" },
    ensureSchema: false,
  });

  assert.ok(
    capturedOperationalEvents.some(
      (event) => event.eventName === "provider_payout_change_requested",
    ),
    "provider_payout_change_requested event is recorded",
  );
  assert.ok(
    capturedOperationalEvents.some(
      (event) => event.eventName === "provider_payout_change_approved",
    ),
    "provider_payout_change_approved event is recorded",
  );
  assert.ok(
    capturedOperationalEvents.some(
      (event) => event.eventName === "provider_payout_account_replaced",
    ),
    "provider_payout_account_replaced event is recorded",
  );
});
