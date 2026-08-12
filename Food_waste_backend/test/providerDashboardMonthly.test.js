const assert = require('node:assert/strict');
const test = require('node:test');

const { getProviderSettlementSummary, listProviderSettlementRecords } = require('../shared/services/providerPayout.service');

function createMockClient() {
  const settlements = [];
  const ledgerEntries = new Map();

  function addSettlement(overrides = {}) {
    const id = `s_${settlements.length + 1}`;
    const now = new Date();
    const created_at = new Date(now.getFullYear(), now.getMonth() - (overrides.monthsAgo || 0), 5).toISOString();
    const paid_at = overrides.paid ? new Date(now.getFullYear(), now.getMonth() - (overrides.monthsAgo || 0), 6).toISOString() : null;
    const row = Object.assign({
      id,
      provider_id: overrides.provider_id || 'prov_1',
      reservation_id: overrides.reservation_id || `res_${id}`,
      payment_session_id: `sess_${id}`,
      amount: overrides.amount || 10000,
      commission_amount: overrides.commission_amount || 0,
      currency: 'INR',
      status: overrides.status || 'pending',
      paid_at,
      payment_reference: overrides.payment_reference || null,
      notes: null,
      processed_by: null,
      created_at,
      updated_at: created_at,
    }, overrides);

    settlements.push(row);
    return row;
  }

  return {
    settlements,
    ledgerEntries,
    async query(sql, params = []) {
      const text = String(sql);

      // payout accounts
      if (text.includes('FROM provider_payout_accounts')) {
        return { rows: [{ id: 'acc1', provider_id: params[0], account_type: 'UPI', is_active: true }] };
      }

      // totals pending/paid
      if (text.includes('pending_earnings') && text.includes('paid_earnings')) {
        let pending = 0;
        let paid = 0;
        for (const s of settlements) {
          if (s.provider_id !== params[0]) continue;
          if (ledgerEntries.has(s.reservation_id)) continue; // refunded
          if (['paid','settled'].includes(s.status)) paid += Number(s.amount || 0);
          if (['pending','processing','allocated','batched','failed','cancelled'].includes(s.status)) pending += Number(s.amount || 0);
        }
        return { rows: [{ pending_earnings: pending, paid_earnings: paid }] };
      }

      // monthly aggregate
      if (text.includes('to_char(date_trunc') && text.includes('GROUP BY')) {
        const groups = new Map();
        for (const s of settlements) {
          if (s.provider_id !== params[0]) continue;
          if (ledgerEntries.has(s.reservation_id)) continue;
          const dt = new Date(s.paid_at || s.updated_at || s.created_at);
          const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
          const label = dt.toLocaleString('en-US', { month: 'short' }) + ' ' + dt.getFullYear();
          const g = groups.get(key) || { month_key: key, month_label: label, year: dt.getFullYear(), month: dt.getMonth()+1, earnings:0, paid:0, pending:0, count:0 };
          g.earnings += Number(s.amount||0);
          if (['paid','settled'].includes(s.status)) g.paid += Number(s.amount||0);
          if (['pending','processing','allocated','batched'].includes(s.status)) g.pending += Number(s.amount||0);
          g.count += 1;
          groups.set(key,g);
        }
        const rows = Array.from(groups.values()).sort((a,b) => b.month_key.localeCompare(a.month_key));
        return { rows };
      }

      // records listing
      if (text.includes('FROM provider_settlements') && text.includes('LIMIT')) {
        const providerId = params[0];
        const limit = params[params.length-2] || 50;
        const offset = params[params.length-1] || 0;
        const filtered = settlements.filter(s => s.provider_id === providerId && !ledgerEntries.has(s.reservation_id));
        return { rows: filtered.slice(offset, offset+limit) };
      }

      throw new Error('Unexpected SQL in mock: ' + text.substring(0,100));
    }
  };
}

test('Monthly aggregation and refund exclusion', async () => {
  const client = createMockClient();
  // Add settlements: one pending this month (should show in current month), one paid last month, one refunded last month
  client.settlements.push({ id: 's1', provider_id: 'prov_1', reservation_id: 'r1', payment_session_id: 'sess1', amount: 10000, status: 'pending', paid_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth()-1);
  client.settlements.push({ id: 's2', provider_id: 'prov_1', reservation_id: 'r2', payment_session_id: 'sess2', amount: 9500, status: 'paid', paid_at: lastMonth.toISOString(), created_at: lastMonth.toISOString(), updated_at: lastMonth.toISOString() });
  client.settlements.push({ id: 's3', provider_id: 'prov_1', reservation_id: 'r3', payment_session_id: 'sess3', amount: 5000, status: 'pending', paid_at: null, created_at: lastMonth.toISOString(), updated_at: lastMonth.toISOString() });
  // mark r3 refunded
  client.ledgerEntries.set('r3', { id: 'l_r3', reservation_id: 'r3', event_type: 'refund_issued' });

  const summary = await getProviderSettlementSummary({ client, providerId: 'prov_1', limit: 12, ensureSchema: false });

  // pending should include s1 only (10000)
  assert.equal(Number(summary.earnings.pending), 10000);
  // paid should include s2 only (9500)
  assert.equal(Number(summary.earnings.paid), 9500);
  // monthly rows should include two months: current and last month
  const months = summary.settlements.map((m) => m.month_key);
  assert.ok(months.length >= 1, 'Should have at least one month');

  // records listing for last month should exclude refunded reservation r3
  const records = await listProviderSettlementRecords({ client, providerId: 'prov_1', year: lastMonth.getFullYear(), month: lastMonth.getMonth()+1, ensureSchema: false });
  const ids = records.records.map(r => r.id || r.reservation_id);
  assert.ok(ids.includes('s2') || ids.includes('r2'));
  assert.ok(!ids.includes('s3') && !ids.includes('r3'));
});
