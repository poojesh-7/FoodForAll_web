const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyRefundCarryForward,
  applyManualCarryForwardProjection,
  applyManualRefundCarryForward,
  calculateAdminMonthlySettlementAmounts,
  calculateMonthSettlementCarryForwardReduction,
  calculateRefundCarryForwardAllocations,
  getOutstandingRefundLiabilityAmount,
  getProviderSettlementSummary,
  listProviderSettlementRecords,
  reduceSettlementCarryForwardUsage,
  summarizeSettlementProjection,
} = require('../shared/services/providerPayout.service');

test('Month settlement validation keeps raw refunds outside liability until carry-forward', () => {
  const records = [
    { amount: 76, status: 'pending', paid_amount: 0, refund_amount: 0 },
    { amount: 19, status: 'pending', paid_amount: 0, refund_amount: 19 },
    { amount: 19, status: 'pending', paid_amount: 0, refund_amount: 19 },
    { amount: 19, status: 'paid', paid_amount: 19, refund_amount: 19 },
  ];
  const totals = records.reduce(
    (result, record) => {
      const monthly = calculateAdminMonthlySettlementAmounts(record);
      result.pending += monthly.pendingAmount;
      result.carryForward += monthly.carryForwardAmount;
      return result;
    },
    { pending: 0, carryForward: 0 },
  );
  const reduction = calculateMonthSettlementCarryForwardReduction({
    settlements: records,
    totalCarryForwardAmount: totals.carryForward,
  });

  assert.equal(totals.pending, 114);
  assert.equal(totals.carryForward, 0);
  assert.equal(reduction.totalPendingAmount, 114);
  assert.equal(reduction.settlementAmount, 114);
});

test('Refund carry-forward remains a liability until settlement release', () => {
  const rows = applyRefundCarryForward([
    { id: 'refund', amount: 20, refund_amount: 20, manual_carry_forward_amount: 20, status: 'paid', created_at: '2026-08-01' },
    { id: 'next-1', amount: 20, refund_amount: 0, manual_carry_forward_amount: 20, status: 'pending', created_at: '2026-08-02' },
    { id: 'next-2', amount: 20, refund_amount: 0, status: 'pending', created_at: '2026-08-03' },
  ]);

  assert.equal(rows.find((row) => row.id === 'refund').display_status, 'Refunded');
  assert.equal(rows.find((row) => row.id === 'next-1').refund_deduction_amount, 0);
  assert.equal(rows.find((row) => row.id === 'next-2').refund_deduction_amount, 0);
  assert.equal(rows.find((row) => row.id === 'next-2').pending_refund_amount, 0);

  const largerRows = applyRefundCarryForward([
    { id: 'refund', amount: 30, refund_amount: 30, manual_carry_forward_amount: 30, status: 'paid', created_at: '2026-08-01' },
    { id: 'next-1', amount: 20, refund_amount: 0, manual_carry_forward_amount: 20, status: 'pending', created_at: '2026-08-02' },
    { id: 'next-2', amount: 20, refund_amount: 0, manual_carry_forward_amount: 10, status: 'pending', created_at: '2026-08-03' },
  ]);

  assert.equal(largerRows.find((row) => row.id === 'next-1').refund_deduction_amount, 0);
  assert.equal(largerRows.find((row) => row.id === 'next-2').refund_deduction_amount, 0);
  assert.equal(largerRows.find((row) => row.id === 'next-2').pending_refund_amount, 0);
});

test('Refunded rows expose the current outstanding liability', () => {
  const rows = applyRefundCarryForward([
    {
      id: 'refunded',
      amount: 19,
      refund_amount: 19,
      manual_carry_forward_amount: 19,
      status: 'paid',
      created_at: '2026-09-03T10:00:00.000Z',
    },
    {
      id: 'future',
      amount: 38,
      refund_amount: 0,
      manual_carry_forward_amount: 19,
      status: 'pending',
      created_at: '2026-09-03T11:00:00.000Z',
    },
  ]);

  const refunded = rows.find((row) => row.id === 'refunded');
  assert.equal(refunded.display_status, 'Refunded');
  assert.equal(refunded.refund_deduction_amount, 0);
  assert.equal(refunded.pending_refund_amount, 0);
  assert.match(refunded.refund_note, /Remaining refund balance: ₹0\.00/);
});

test('Refund carry-forward consumes remaining liability across multiple pending settlements until zero', () => {
  const allocations = calculateRefundCarryForwardAllocations({
    refundAmount: 57,
    alreadyCarriedForward: 0,
    pendingSettlements: [
      { id: 's1', amount: 38, paid_amount: 0, manual_carry_forward_amount: 0 },
      { id: 's2', amount: 9.5, paid_amount: 0, manual_carry_forward_amount: 0 },
      { id: 's3', amount: 28.5, paid_amount: 0, manual_carry_forward_amount: 0 },
    ],
  });

  assert.deepEqual(allocations.map((item) => ({
    id: item.id,
    carryForwardAmount: item.carryForwardAmount,
    remainingAfter: item.remainingAfter,
  })), [
    { id: 's1', carryForwardAmount: 38, remainingAfter: 19 },
    { id: 's2', carryForwardAmount: 9.5, remainingAfter: 9.5 },
    { id: 's3', carryForwardAmount: 9.5, remainingAfter: 0 },
  ]);
});

test('Refund carry-forward does not reduce pending rows before settlement', () => {
  const rows = applyRefundCarryForward([
    { id: 'refund-57', amount: 57, refund_amount: 57, status: 'paid', created_at: '2026-09-01' },
    { id: 'target-38', amount: 38, status: 'pending', created_at: '2026-09-02' },
    { id: 'target-9-5', amount: 9.5, status: 'pending', created_at: '2026-09-03' },
    { id: 'target-28-5', amount: 28.5, status: 'batched', created_at: '2026-09-04' },
  ]);

  assert.deepEqual(rows.map((row) => ({
    amount: row.amount,
    recovery: row.refund_deduction_amount,
    net: row.net_payable,
  })), [
    { amount: 57, recovery: 0, net: 0 },
    { amount: 38, recovery: 0, net: 38 },
    { amount: 9.5, recovery: 0, net: 9.5 },
    { amount: 28.5, recovery: 0, net: 28.5 },
  ]);
  assert.equal(rows[1].pending_refund_amount, 0);
  assert.equal(rows.at(-1).pending_refund_amount, 0);
});

test('Month settlement reduction applies the carry-forward sum once against total pending', () => {
  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements: [
      { amount: 20, paid_amount: 0, manual_carry_forward_amount: 0 },
      { amount: 30, paid_amount: 0, manual_carry_forward_amount: 0 },
      { amount: 40, paid_amount: 0, manual_carry_forward_amount: 0 },
      { amount: 20, paid_amount: 0, manual_carry_forward_amount: 20 },
      { amount: 30, paid_amount: 0, manual_carry_forward_amount: 30 },
      { amount: 40, paid_amount: 0, manual_carry_forward_amount: 40 },
    ],
    carryForwardAmount: 90,
  });

  assert.equal(reduction.totalPendingAmount, 180);
  assert.equal(reduction.carryForwardAmount, 90);
  assert.equal(reduction.settlementAmount, 90);
  assert.equal(reduction.remainingCarryForward, 0);
  assert.equal(reduction.reduced, true);
});

test('Month settlement reduction accepts admin operation parameter names in either record order', () => {
  const pendingThenRefunded = calculateMonthSettlementCarryForwardReduction({
    settlements: [
      { id: 'pending-20', amount: 20, paid_amount: 0, refund_amount: 0 },
      { id: 'refunded-60', amount: 60, paid_amount: 0, refund_amount: 60 },
    ],
    totalCarryForwardAmount: 60,
  });
  const refundedThenPending = calculateMonthSettlementCarryForwardReduction({
    settlements: [
      { id: 'refunded-20', amount: 20, paid_amount: 0, refund_amount: 20 },
      { id: 'pending-60', amount: 60, paid_amount: 0, refund_amount: 0 },
    ],
    totalCarryForwardAmount: 20,
  });

  assert.equal(pendingThenRefunded.settlementAmount, 20);
  assert.equal(refundedThenPending.settlementAmount, 60);
  assert.equal(pendingThenRefunded.totalPendingAmount, 80);
  assert.equal(refundedThenPending.totalPendingAmount, 80);
});

test('Manual refund carry-forward does not project automatically across future settlements', async () => {
  const client = createCarryForwardMockClient([
    {
      id: 'refund-57',
      provider_id: 'prov_1',
      reservation_id: 'refund-res',
      payment_session_id: 'refund-session',
      amount: 57,
      status: 'paid',
      manual_carry_forward_amount: 0,
      refund_amount: 57,
      refund_id: 'refund-ledger-57',
      created_at: '2026-09-04T07:58:00.000Z',
    },
    {
      id: 'target-38',
      provider_id: 'prov_1',
      reservation_id: 'target-res-38',
      payment_session_id: 'target-session-38',
      amount: 38,
      paid_amount: 0,
      status: 'pending',
      manual_carry_forward_amount: 0,
      created_at: '2026-09-04T08:03:00.000Z',
    },
    {
      id: 'target-9-5',
      provider_id: 'prov_1',
      reservation_id: 'target-res-9-5',
      payment_session_id: 'target-session-9-5',
      amount: 9.5,
      paid_amount: 0,
      status: 'pending',
      manual_carry_forward_amount: 0,
      created_at: '2026-09-04T08:06:00.000Z',
    },
    {
      id: 'target-28-5',
      provider_id: 'prov_1',
      reservation_id: 'target-res-28-5',
      payment_session_id: 'target-session-28-5',
      amount: 28.5,
      paid_amount: 0,
      status: 'batched',
      manual_carry_forward_amount: 0,
      created_at: '2026-09-04T08:08:00.000Z',
    },
  ]);

  const result = await applyManualRefundCarryForward({
    client,
    refundSettlementId: 'refund-57',
    adminId: 'admin-1',
    notes: 'recover refund',
    ensureSchema: false,
  });

  assert.equal(result.carryForwardAmount, 57);
  assert.equal(result.remainingToCarryForward, 0);
  assert.deepEqual(
    result.refundSettlement.manual_carry_forward_amount,
    57,
  );

  const projected = applyRefundCarryForward(client.settlements);
  assert.deepEqual(
    projected.map((row) => ({
      id: row.id,
      amount: row.amount,
      recovery: row.refund_deduction_amount,
      net: row.net_payable,
      liability: row.pending_refund_amount,
    })),
    [
      { id: 'refund-57', amount: 57, recovery: 0, net: 0, liability: 0 },
      { id: 'target-38', amount: 38, recovery: 0, net: 38, liability: 0 },
      { id: 'target-9-5', amount: 9.5, recovery: 0, net: 9.5, liability: 0 },
      { id: 'target-28-5', amount: 28.5, recovery: 0, net: 28.5, liability: 0 },
    ],
  );
  assert.equal(client.releases.length, 0);
});

test('Manual refund carry-forward compares created_at against timestamp, not the refund settlement id', async () => {
  const seenParams = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes('WHERE ps.id = $1')) {
        return {
          rows: [{
            id: 'refund-57',
            provider_id: 'prov_1',
            reservation_id: 'refund-res',
            payment_session_id: 'refund-session',
            amount: 57,
            status: 'paid',
            created_at: '2026-09-04T07:58:00.000Z',
            manual_carry_forward_amount: 0,
            refund_amount: 57,
          }],
        };
      }

      if (text.includes('WHERE ps.provider_id = $1') && text.includes('ps.created_at > $4')) {
        seenParams.push(params);
        return { rows: [{
          id: 'target-38',
          provider_id: 'prov_1',
          reservation_id: 'target-res-38',
          payment_session_id: 'target-session-38',
          amount: 38,
          paid_amount: 0,
          status: 'pending',
          created_at: '2026-09-04T08:03:00.000Z',
        }] };
      }

      if (text.includes('UPDATE provider_settlements')) {
        return { rows: [{
          id: 'refund-57',
          provider_id: 'prov_1',
          amount: 57,
          status: 'paid',
          manual_carry_forward_amount: 57,
          manual_carry_forward_applied_at: '2026-09-04T08:10:00.000Z',
          manual_carry_forward_applied_by: 'admin-1',
        }] };
      }

      return { rows: [] };
    },
  };

  await applyManualRefundCarryForward({
    client,
    refundSettlementId: 'refund-57',
    adminId: 'admin-1',
    notes: 'recover refund',
    ensureSchema: false,
  });

  assert.equal(seenParams[0][1], 'refund-57');
  assert.equal(seenParams[0][3], '2026-09-04T07:58:00.000Z');
  assert.equal(typeof seenParams[0][3], 'string');
});

test('Month settlement consumes carry-forward from the pending rows and clears only the used portion', () => {
  const settled = reduceSettlementCarryForwardUsage({
    settlements: [
      { id: 'row-1', manual_carry_forward_amount: 30 },
      { id: 'row-2', manual_carry_forward_amount: 25 },
      { id: 'row-3', manual_carry_forward_amount: 15 },
    ],
    totalCarryForwardAmount: 40,
  });

  assert.deepEqual(
    settled.settlements.map((row) => ({
      id: row.id,
      manual_carry_forward_amount: row.manual_carry_forward_amount,
    })),
    [
      { id: 'row-1', manual_carry_forward_amount: 0 },
      { id: 'row-2', manual_carry_forward_amount: 15 },
      { id: 'row-3', manual_carry_forward_amount: 15 },
    ],
  );
  assert.equal(settled.remainingCarryForward, 0);
  assert.equal(settled.consumedCarryForward, 40);
});

test('Month settlement leaves carry-forward only when it exceeds pending amount', () => {
  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements: [
      { id: 'row-1', amount: 38, paid_amount: 0, manual_carry_forward_amount: 0 },
      { id: 'row-2', amount: 19, paid_amount: 0, manual_carry_forward_amount: 0 },
    ],
    carryForwardAmount: 57,
  });

  assert.equal(reduction.totalPendingAmount, 57);
  assert.equal(reduction.settlementAmount, 0);
  assert.equal(reduction.remainingCarryForward, 0);

  const excess = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements: [
      { id: 'row-1', amount: 38, paid_amount: 0, manual_carry_forward_amount: 0 },
    ],
    carryForwardAmount: 57,
  });

  assert.equal(excess.settlementAmount, 0);
  assert.equal(excess.remainingCarryForward, 19);
});

test('Dashboard projections subtract admin-applied carry-forward from pending rows', () => {
  const rows = applyManualCarryForwardProjection([
    { id: 'refund', provider_id: 'prov_1', amount: 57, refund_amount: 57, manual_carry_forward_amount: 57, status: 'paid', created_at: '2026-09-01' },
    { id: 'pending-1', provider_id: 'prov_1', amount: 38, paid_amount: 0, status: 'pending', created_at: '2026-09-02', refund_deduction_amount: 0 },
    { id: 'pending-2', provider_id: 'prov_1', amount: 28.5, paid_amount: 0, status: 'pending', created_at: '2026-09-03', refund_deduction_amount: 0 },
  ]);

  assert.equal(rows.find((row) => row.id === 'pending-1').net_payable, 0);
  assert.equal(rows.find((row) => row.id === 'pending-2').net_payable, 9.5);
  assert.equal(rows.find((row) => row.id === 'pending-2').refund_deduction_amount, 19);
});

function createCarryForwardMockClient(initialSettlements) {
  const settlements = initialSettlements.map((row) => ({
    paid_amount: 0,
    manual_carry_forward_amount: 0,
    ...row,
  }));
  const releases = [];

  return {
    settlements,
    releases,
    async query(sql, params = []) {
      const text = String(sql);

      if (
        text.includes('FROM provider_settlements ps') &&
        text.includes('WHERE ps.id = $1') &&
        text.includes('FOR UPDATE')
      ) {
        const row = settlements.find((settlement) => settlement.id === params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }

      if (
        text.includes('FROM provider_settlements ps') &&
        text.includes('ps.created_at > $4') &&
        text.includes('FOR UPDATE')
      ) {
        const [providerId, refundSettlementId, statuses, createdAt] = params;
        return {
          rows: settlements
            .filter((settlement) =>
              settlement.provider_id === providerId &&
              settlement.id !== refundSettlementId &&
              statuses.includes(settlement.status) &&
              settlement.created_at > createdAt &&
              Number(settlement.refund_amount || 0) === 0 &&
              Math.max(
                Number(settlement.amount || 0) -
                  Number(settlement.paid_amount || 0) -
                  Number(settlement.manual_carry_forward_amount || 0),
                0,
              ) > 0
            )
            .sort((left, right) =>
              left.created_at.localeCompare(right.created_at) ||
              left.id.localeCompare(right.id)
            )
            .map((settlement) => ({ ...settlement })),
        };
      }

      if (text.includes('UPDATE provider_settlements')) {
        const [settlementId, amount, adminId, notes] = params;
        const row = settlements.find((settlement) => settlement.id === settlementId);
        if (!row) return { rows: [] };
        row.manual_carry_forward_amount =
          Math.round((Number(row.manual_carry_forward_amount || 0) + Number(amount || 0)) * 100) / 100;
        row.manual_carry_forward_applied_at =
          row.manual_carry_forward_applied_at || '2026-09-04T08:10:00.000Z';
        row.manual_carry_forward_applied_by = adminId || null;
        row.manual_carry_forward_notes = notes || null;
        return { rows: [{ ...row }] };
      }

      if (text.includes('FROM provider_settlements target')) {
        const target = settlements.find((settlement) => settlement.id === params[1]);
        const source = settlements.find((settlement) => settlement.id === params[0]);
        return {
          rows: target
            ? [{
                reservation_id: target.reservation_id,
                payment_session_id: target.payment_session_id,
                refund_id: source?.refund_id || null,
              }]
            : [],
        };
      }

      if (text.includes('INSERT INTO financial_ledger_entries')) {
        const row = {
          reservation_id: params[0],
          payment_session_id: params[1],
          provider_settlement_id: params[2],
          event_type: params[3],
          amount: params[4],
          actor_user_id: params[5],
          actor_role: params[6],
          accounting_category: params[7],
          refund_id: params[8],
          idempotency_key: params[9],
          metadata: JSON.parse(params[10] || '{}'),
        };
        if (!releases.some((entry) => entry.idempotency_key === row.idempotency_key)) {
          releases.push(row);
        }
        return { rows: [] };
      }

      throw new Error('Unexpected SQL in carry-forward mock: ' + text.substring(0, 120));
    },
  };
}

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
      paid_amount: overrides.paid_amount || 0,
      manual_carry_forward_amount: overrides.manual_carry_forward_amount || 0,
      manual_carry_forward_applied_at: overrides.manual_carry_forward_applied_at || null,
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
        const refunds = settlements.reduce((sum, settlement) => {
          const entry = ledgerEntries.get(settlement.reservation_id);
          return sum + (entry ? Number(entry.amount || 0) : 0);
        }, 0);
        return {
          rows: [{
            pending_earnings: pending,
            paid_earnings: paid,
            user_refunds: refunds,
            refunded_deducted: refunds,
            pending_refunds: 0,
            user_refund_count: refunds > 0 ? 1 : 0,
          }],
        };
      }

      // monthly aggregate
      if (text.includes("date_trunc('month'") && text.includes('GROUP BY')) {
        const groups = new Map();
        for (const s of settlements) {
          if (s.provider_id !== params[0]) continue;
          const dt = new Date(s.paid_at || s.updated_at || s.created_at);
          const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
          const label = dt.toLocaleString('en-US', { month: 'short' }) + ' ' + dt.getFullYear();
          const refund = ledgerEntries.get(s.reservation_id);
          if (refund) {
            const g = groups.get(key) || { month_key: key, month_label: label, year: dt.getFullYear(), month: dt.getMonth()+1, earnings:0, paid:0, pending:0, refunded:0, count:0 };
            g.refunded += Number(refund.amount || 0);
            g.count += 1;
            groups.set(key,g);
            continue;
          }
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
      if (text.includes('FROM provider_settlements ps')) {
        const providerId = params[0];
        const filtered = settlements
          .filter(s => s.provider_id === providerId)
          .map((settlement) => ({
            ...settlement,
            refund_amount: Number(ledgerEntries.get(settlement.reservation_id)?.amount || 0),
            manual_carry_forward_amount: Number(settlement.manual_carry_forward_amount || 0),
            paid_amount: Number(settlement.paid_amount || 0),
          }));
        return { rows: filtered };
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
  client.ledgerEntries.set('r3', { id: 'l_r3', reservation_id: 'r3', event_type: 'refund_issued', amount: 5000 });

  const summary = await getProviderSettlementSummary({ client, providerId: 'prov_1', limit: 12, ensureSchema: false });

  // gross pending includes the active pending and refunded pending settlement
  assert.equal(Number(summary.earnings.pending), 15000);
  // paid should include only the settled amount (9500)
  assert.equal(Number(summary.earnings.paid), 9500);
  // monthly rows should include two months: current and last month
  const months = summary.settlements.map((m) => m.month_key);
  assert.ok(months.length >= 1, 'Should have at least one month');

  // records listing keeps the refunded row visible with its refund status and amount
  const records = await listProviderSettlementRecords({ client, providerId: 'prov_1', year: lastMonth.getFullYear(), month: lastMonth.getMonth()+1, ensureSchema: false });
  const ids = records.records.map(r => r.id || r.reservation_id);
  assert.ok(ids.includes('s2') || ids.includes('r2'));
  assert.ok(ids.includes('s3') || ids.includes('r3'));
  assert.equal(records.records.find((row) => row.id === 's3')?.display_status, 'Refunded');
});

test('Provider summary exposes outstanding refund liability after a post-settlement refund', async () => {
  const client = createMockClient();
  const now = new Date();
  const paidAt = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
  const pendingAt = new Date(now.getFullYear(), now.getMonth(), 3).toISOString();

  client.settlements.push(
    { id: 'paid-1', provider_id: 'prov_1', reservation_id: 'paid-1', payment_session_id: 'paid-1', amount: 1200, status: 'paid', paid_at: paidAt, created_at: paidAt, updated_at: paidAt },
    { id: 'pending-1', provider_id: 'prov_1', reservation_id: 'pending-1', payment_session_id: 'pending-1', amount: 1800, status: 'pending', created_at: pendingAt, updated_at: pendingAt },
  );
  client.ledgerEntries.set('paid-1', { amount: 450 });

  const summary = await getProviderSettlementSummary({ client, providerId: 'prov_1', ensureSchema: false });

  assert.equal(summary.earnings.pending, 1800);
  assert.equal(summary.earnings.paid, 750);
  assert.equal(summary.refunds.total, 0);
  assert.equal(summary.refunds.pending, 0);
});

test('Released liability is excluded while later refund liabilities remain outstanding', () => {
  const rows = [
    {
      amount: 28.5,
      refund_amount: 28.5,
      recorded_carry_forward_amount: 28.5,
      status: 'paid',
    },
    {
      amount: 38,
      refund_amount: 38,
      manual_carry_forward_amount: 38,
      status: 'pending',
    },
    {
      amount: 19,
      refund_amount: 19,
      manual_carry_forward_amount: 19,
      status: 'pending',
    },
  ];

  assert.deepEqual(
    rows.map(getOutstandingRefundLiabilityAmount),
    [0, 38, 19],
  );
  assert.equal(
    rows.reduce((sum, row) => sum + getOutstandingRefundLiabilityAmount(row), 0),
    57,
  );
});

test('Refund accounting follows carry-forward and settlement lifecycle buckets', () => {
  const summarize = (rows) => summarizeSettlementProjection(rows);
  const pending = (extra = {}) => ({
    id: 'pending-28-5',
    amount: 28.5,
    paid_amount: 0,
    status: 'pending',
    refund_amount: 0,
    ...extra,
  });

  let summary = summarize([
    pending(),
    { id: 'refund-38', amount: 38, status: 'pending', refund_amount: 38 },
  ]);
  assert.deepEqual(
    {
      pending: summary.earnings.pending,
      paid: summary.earnings.paid,
      refunds: summary.refunds.total,
      liability: summary.refunds.pending,
    },
    { pending: 66.5, paid: 0, refunds: 0, liability: 0 },
  );

  summary = summarize([
    pending(),
    {
      id: 'refund-38',
      amount: 38,
      status: 'pending',
      refund_amount: 38,
      manual_carry_forward_amount: 38,
    },
  ]);
  assert.deepEqual(
    {
      pending: summary.earnings.pending,
      paid: summary.earnings.paid,
      refunds: summary.refunds.total,
      liability: summary.refunds.pending,
    },
    { pending: 66.5, paid: 0, refunds: 0, liability: 38 },
  );

  summary = summarize([
    pending({ status: 'paid', paid_amount: 28.5, payment_reference: 'UTR111111111111' }),
    {
      id: 'refund-38',
      amount: 38,
      status: 'pending',
      refund_amount: 38,
      recorded_refund_deduction_amount: 38,
      recorded_carry_forward_amount: 38,
      manual_carry_forward_amount: 0,
    },
  ]);
  assert.deepEqual(
    {
      pending: summary.earnings.pending,
      paid: summary.earnings.paid,
      refunds: summary.refunds.total,
      liability: summary.refunds.pending,
    },
    { pending: 0, paid: 28.5, refunds: 38, liability: 0 },
  );

  summary = summarize([
    {
      id: 'settled-refunded-28-5',
      amount: 28.5,
      paid_amount: 28.5,
      status: 'paid',
      refund_amount: 28.5,
      recorded_refund_deduction_amount: 0,
    },
    {
      id: 'refund-38',
      amount: 38,
      status: 'pending',
      refund_amount: 38,
      recorded_refund_deduction_amount: 38,
      recorded_carry_forward_amount: 38,
      manual_carry_forward_amount: 0,
    },
  ]);
  assert.deepEqual(
    {
      pending: summary.earnings.pending,
      paid: summary.earnings.paid,
      refunds: summary.refunds.total,
      liability: summary.refunds.pending,
    },
    { pending: 0, paid: 28.5, refunds: 38, liability: 0 },
  );

  summary = summarize([
    {
      id: 'settled-refunded-28-5',
      amount: 28.5,
      paid_amount: 28.5,
      status: 'paid',
      refund_amount: 28.5,
      manual_carry_forward_amount: 28.5,
    },
    {
      id: 'refund-38',
      amount: 38,
      status: 'pending',
      refund_amount: 38,
      recorded_refund_deduction_amount: 38,
      manual_carry_forward_amount: 0,
    },
  ]);
  assert.deepEqual(
    {
      pending: summary.earnings.pending,
      paid: summary.earnings.paid,
      refunds: summary.refunds.total,
      liability: summary.refunds.pending,
    },
    { pending: 38, paid: 28.5, refunds: 38, liability: 28.5 },
  );

  summary = summarize([
    {
      id: 'next-40',
      amount: 40,
      paid_amount: 9.5,
      status: 'paid',
      refund_amount: 0,
      recorded_refund_deduction_amount: 28.5,
    },
    {
      id: 'settled-refunded-28-5',
      amount: 28.5,
      paid_amount: 28.5,
      status: 'paid',
      refund_amount: 28.5,
      manual_carry_forward_amount: 0,
    },
    {
      id: 'refund-38',
      amount: 38,
      status: 'pending',
      refund_amount: 38,
      recorded_refund_deduction_amount: 38,
      manual_carry_forward_amount: 0,
    },
  ]);
  assert.deepEqual(
    {
      pending: summary.earnings.pending,
      paid: summary.earnings.paid,
      refunds: summary.refunds.total,
      liability: summary.refunds.pending,
    },
    { pending: 38, paid: 38, refunds: 66.5, liability: 0 },
  );
});

test('Provider summary keeps refund liability after a future settlement partially absorbs it', async () => {
  const client = createMockClient();
  const now = new Date();
  const firstDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const secondDate = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();

  client.settlements.push(
    { id: 'paid-1', provider_id: 'prov_1', reservation_id: 'paid-1', payment_session_id: 'paid-1', amount: 1000, manual_carry_forward_amount: 500, status: 'paid', paid_at: firstDate, created_at: firstDate, updated_at: firstDate },
    { id: 'pending-1', provider_id: 'prov_1', reservation_id: 'pending-1', payment_session_id: 'pending-1', amount: 900, manual_carry_forward_amount: 500, status: 'pending', created_at: secondDate, updated_at: secondDate },
  );
  client.ledgerEntries.set('paid-1', { amount: 700 });

  const summary = await getProviderSettlementSummary({ client, providerId: 'prov_1', ensureSchema: false });

  assert.equal(summary.earnings.pending, 900);
  assert.equal(summary.earnings.paid, 300);
  assert.equal(summary.refunds.total, 0);
  assert.equal(summary.refunds.pending, 1000);
});

test('Provider accounting separates earnings from refund adjustments', async () => {
  const client = createMockClient();
  client.settlements.push(
    { id: 'pending-1', provider_id: 'prov_1', reservation_id: 'p1', payment_session_id: 'p1', amount: 950, manual_carry_forward_amount: 950, status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'pending-2', provider_id: 'prov_1', reservation_id: 'p2', payment_session_id: 'p2', amount: 475, manual_carry_forward_amount: 475, status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'pending-3', provider_id: 'prov_1', reservation_id: 'p3', payment_session_id: 'p3', amount: 950, manual_carry_forward_amount: 475, status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'paid-1', provider_id: 'prov_1', reservation_id: 'paid-1', payment_session_id: 'paid-1', amount: 2850, status: 'paid', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'refund-1', provider_id: 'prov_1', reservation_id: 'refund-1', payment_session_id: 'refund-1', amount: 1900, manual_carry_forward_amount: 1900, status: 'paid', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  );
  client.ledgerEntries.set('refund-1', { amount: 1900 });

  const summary = await getProviderSettlementSummary({ client, providerId: 'prov_1', ensureSchema: false });

  assert.equal(summary.earnings.pending, 2375);
  assert.equal(summary.earnings.paid, 2850);
  assert.equal(summary.refunds.total, 0);
  assert.equal(summary.refunds.pending, 3800);
  assert.equal(summary.earnings.pending + summary.earnings.paid, 5225);
  assert.equal(summary.refunds.total, 0);
});

test('Refund liability is scoped per month and resets at boundaries', () => {
  const now = new Date();
  const sept1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const sept15 = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const oct1 = new Date(now.getFullYear(), now.getMonth(), 1);

  const rows = applyRefundCarryForward([
    // September: Refund + recovery
    { 
      id: 'sept-refund', 
      amount: 100, 
      refund_amount: 100, 
      manual_carry_forward_amount: 0, 
      status: 'paid', 
      created_at: sept1.toISOString() 
    },
    { 
      id: 'sept-target', 
      amount: 50, 
      refund_amount: 0, 
      manual_carry_forward_amount: 100, 
      status: 'pending', 
      created_at: sept15.toISOString() 
    },
    // October: New refund (liability should reset to 0 at month boundary)
    { 
      id: 'oct-refund', 
      amount: 50, 
      refund_amount: 50, 
      manual_carry_forward_amount: 0, 
      status: 'paid', 
      created_at: oct1.toISOString() 
    },
  ]);

  // September liability remains until a settlement release is recorded.
  assert.equal(rows.find(r => r.id === 'sept-target').pending_refund_amount, 0);
  
  // October's liability is represented by the summary until settlement release.
  assert.equal(rows.find(r => r.id === 'oct-refund').pending_refund_amount, 0);
});

test('Partial carry-forward amount carries to next month', () => {
  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements: [
      { amount: 50, paid_amount: 0, manual_carry_forward_amount: 50 },
      { amount: 30, paid_amount: 0, manual_carry_forward_amount: 50 },
    ],
    carryForwardAmount: 100,
  });

  assert.equal(reduction.totalPendingAmount, 80);
  assert.equal(reduction.carryForwardAmount, 100);
  assert.equal(reduction.settlementAmount, 0);
  assert.equal(reduction.remainingCarryForward, 20);
  assert.equal(reduction.reduced, true);
});

test('Carry-forward does not leak between different providers', () => {
  const rows = applyRefundCarryForward([
    // Provider 1: September refund
    { 
      id: 'p1-refund', 
      amount: 100, 
      refund_amount: 100, 
      manual_carry_forward_amount: 0, 
      status: 'paid', 
      created_at: new Date(2026, 8, 1).toISOString(),
      provider_id: 'prov_1'
    },
    { 
      id: 'p1-target', 
      amount: 50, 
      refund_amount: 0, 
      manual_carry_forward_amount: 100, 
      status: 'pending', 
      created_at: new Date(2026, 8, 15).toISOString(),
      provider_id: 'prov_1'
    },
    // Provider 2: September refund (should not see p1 liability)
    { 
      id: 'p2-refund', 
      amount: 80, 
      refund_amount: 80, 
      manual_carry_forward_amount: 0, 
      status: 'paid', 
      created_at: new Date(2026, 8, 1).toISOString(),
      provider_id: 'prov_2'
    },
  ]);

  // P1's carry-forward does not release liability before settlement.
  assert.equal(rows.find(r => r.id === 'p1-target').pending_refund_amount, 0);
  
  // P2 remains isolated from P1; row-level liability is exposed by the summary.
  assert.equal(rows.find(r => r.id === 'p2-refund').pending_refund_amount, 0);
});
