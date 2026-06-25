const path = require('node:path');
require.cache[path.resolve(__dirname, 'shared/services/observability.service.js')] = {
  id: path.resolve(__dirname, 'shared/services/observability.service.js'),
  filename: path.resolve(__dirname, 'shared/services/observability.service.js'),
  loaded: true,
  exports: {
    recordOperationalEvent: async () => {},
  },
};
const payoutService = require(path.resolve(__dirname, 'shared/services/providerPayout.service.js'));
const { replaceProviderPayoutAccount, verifyProviderPayoutAccount, requestProviderPayoutAccountChange, approveProviderPayoutAccountChange } = payoutService;
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accounts = [];

const client = {
  async query(sql, params = []) {
    const text = String(sql);
    console.log('--- QUERY ---');
    console.log(text.trim());
    console.log('PARAMS', JSON.stringify(params));

    if (text.includes('INSERT INTO provider_payout_accounts')) {
      const row = {
        id: `account_${accounts.length + 1}`,
        provider_id: params[0],
        account_type: params[1],
        upi_id: params[2] || null,
        account_holder_name: params[3] || null,
        bank_account_number: params[4] || null,
        ifsc_code: params[5] || null,
        is_active: params[6],
        is_verified: false,
        verification_status: 'pending',
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
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      };
      accounts.push(row);
      return { rows: [{ ...row }] };
    }

    if (text.includes('UPDATE provider_payout_accounts')) {
      console.log('UPDATE HANDLER');
      const updatedRows = [];
      if (text.includes("change_request_status='pending'")) {
        const payoutAccountId = params[0];
        const reason = params[1];
        const providerId = params[2];
        for (const account of accounts) {
          if (account.id === payoutAccountId && account.is_active) {
            account.change_request_status = 'pending';
            account.change_request_reason = reason;
            account.change_requested_at = '2026-01-10T00:00:00.000Z';
            account.change_requested_by = providerId;
            account.change_reviewed_at = null;
            account.change_reviewed_by = null;
            account.change_review_notes = null;
            account.updated_at = '2026-01-10T00:00:00.000Z';
            updatedRows.push({ ...account });
          }
        }
        console.log('updatedRows', JSON.stringify(updatedRows, null, 2));
        return { rowCount: updatedRows.length, rows: updatedRows };
      }
      if (text.includes("change_request_status='replacement_pending'")) {
        const payoutAccountId = params[0];
        const adminId = params[1];
        const notes = params[2];
        for (const account of accounts) {
          if (account.id === payoutAccountId && account.is_active) {
            account.change_request_status = 'replacement_pending';
            account.change_reviewed_at = '2026-01-10T00:00:00.000Z';
            account.change_reviewed_by = adminId;
            account.change_review_notes = notes;
            account.updated_at = '2026-01-10T00:00:00.000Z';
            updatedRows.push({ ...account });
          }
        }
        console.log('updatedRows', JSON.stringify(updatedRows, null, 2));
        return { rowCount: updatedRows.length, rows: updatedRows };
      }
      if (text.includes("verification_status='verified'")) {
        const payoutAccountId = params[0];
        const adminId = params[1];
        for (const account of accounts) {
          if (account.id === payoutAccountId && account.is_active) {
            account.verification_status = 'verified';
            account.is_verified = true;
            account.verified_at = '2026-01-10T00:00:00.000Z';
            account.verified_by = adminId;
            account.rejection_reason = null;
            account.updated_at = '2026-01-10T00:00:00.000Z';
            updatedRows.push({ ...account });
          }
        }
        console.log('updatedRows', JSON.stringify(updatedRows, null, 2));
        return { rowCount: updatedRows.length, rows: updatedRows };
      }
      if (text.includes('SET is_active=false')) {
        const providerId = params[0];
        for (const account of accounts) {
          if (account.provider_id === providerId && account.is_active) {
            account.is_active = false;
            account.updated_at = '2026-01-10T00:00:00.000Z';
            updatedRows.push({ ...account });
          }
        }
        console.log('updatedRows', JSON.stringify(updatedRows, null, 2));
        return { rowCount: updatedRows.length, rows: updatedRows };
      }
      if (text.includes('SET is_active=true')) {
        const id = params[0];
        for (const account of accounts) {
          if (account.id === id) {
            account.is_active = true;
            account.updated_at = '2026-01-10T00:00:00.000Z';
            updatedRows.push({ ...account });
          }
        }
        return { rowCount: updatedRows.length, rows: updatedRows };
      }
      console.log('unhandled update');
      return { rows: [] };
    }

    if (text.includes('FROM provider_payout_accounts')) {
      console.log('SELECT FROM provider_payout_accounts');
      if (text.includes('WHERE id=$1')) {
        const id = params[0];
        return { rows: accounts.filter((account) => account.id === id).map((account) => ({ ...account })) };
      }
      const providerId = params[0];
      return { rows: accounts.filter((account) => account.provider_id === providerId).map((account) => ({ ...account })) };
    }

    throw new Error('Unexpected query: ' + text);
  },
};

(async () => {
  const newAccount = await replaceProviderPayoutAccount({ client, providerId: PROVIDER_ID, payload: { account_type: 'UPI', upi_id: 'verified@upi' }, ensureSchema: false });
  console.log('newAccount', newAccount);
  const verified = await verifyProviderPayoutAccount({ client, payoutAccountId: newAccount.id, adminId: ADMIN_ID, ensureSchema: false });
  console.log('verified', verified);
  const requested = await requestProviderPayoutAccountChange({ client, providerId: PROVIDER_ID, reason: 'Need update', ensureSchema: false });
  console.log('requested', requested);
  const approved = await approveProviderPayoutAccountChange({
    client,
    payoutAccountId: requested.id,
    adminId: ADMIN_ID,
    reason: 'Approved for update',
    ensureSchema: false,
  });
  console.log('approved', approved);

  const replacement = await replaceProviderPayoutAccount({
    client,
    providerId: PROVIDER_ID,
    payload: { account_type: 'UPI', upi_id: 'new@upi' },
    ensureSchema: false,
  });
  console.log('replacement', replacement);
  console.log('accounts', accounts);
})().catch((err) => {
  console.error('ERROR', err);
  process.exit(1);
});
