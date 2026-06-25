const {
  replaceProviderPayoutAccount,
  verifyProviderPayoutAccount,
  requestProviderPayoutAccountChange,
} = require("./shared/services/providerPayout.service");
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accounts = [];
const client = {
  accounts,
  async query(sql, params = []) {
    const text = String(sql);
    console.log("QUERY:", text.replace(/\s+/g, " ").trim(), "PARAMS:", params);
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
      } else if (text.includes("change_request_status='pending'")) {
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
    if (text.includes("FROM provider_payout_accounts")) {
      const providerId = params[0];
      const rows = accounts
        .filter((account) => account.provider_id === providerId)
        .sort((left, right) => Number(right.is_active) - Number(left.is_active))
        .map((account) => ({ ...account }));
      return { rows };
    }
    throw new Error("Unexpected query: " + text);
  },
};
(async () => {
  const original = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: "UPI", upi_id: "verified@upi" },
    ensureSchema: false,
  });
  console.log("original", original);
  const verified = await verifyProviderPayoutAccount({
    client,
    payoutAccountId: original.id,
    adminId: ADMIN_ID,
    ensureSchema: false,
  });
  console.log("verified", verified);
  console.log(
    "accounts after verify",
    JSON.stringify(client.accounts, null, 2),
  );
  try {
    const requested = await requestProviderPayoutAccountChange({
      client,
      providerId: PROVIDER_ID,
      reason: "Update bank details",
      ensureSchema: false,
    });
    console.log("requested", requested);
  } catch (err) {
    console.error("ERROR", err);
  }
})();
