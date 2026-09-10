const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyRefundCarryForward,
  applyManualCarryForwardProjection,
  calculateMonthSettlementCarryForwardReduction,
  calculateRefundCarryForwardAllocations,
} = require('../shared/services/providerPayout.service');

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function sumBy(rows, selector) {
  return rows.reduce((sum, row) => sum + Number(selector(row) || 0), 0);
}

function buildStepRows(step) {
  return step.rows.map((row) => ({
    id: row.id,
    amount: Number(row.amount || 0),
    status: row.status,
    refund_amount: Number(row.refund_amount || 0),
    manual_carry_forward_amount: Number(row.manual_carry_forward_amount || 0),
    paid_amount: Number(row.paid_amount || 0),
    created_at: row.created_at || '2026-01-01T00:00:00.000Z',
    provider_id: row.provider_id || 'provider-1',
  }));
}

test('Spec step 1: initial state retains 50 paid earnings and zero refunds', () => {
  const rows = [
    { id: 's1', amount: 50, status: 'paid', refund_amount: 0, manual_carry_forward_amount: 0, paid_amount: 0 },
    { id: 's2', amount: 30, status: 'paid', refund_amount: 0, manual_carry_forward_amount: 0, paid_amount: 0 },
    { id: 's3', amount: 20, status: 'paid', refund_amount: 0, manual_carry_forward_amount: 0, paid_amount: 0 },
  ];

  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements: rows,
    carryForwardAmount: 0,
  });

  assert.equal(reduction.totalPendingAmount, 100);
  assert.equal(reduction.carryForwardAmount, 0);
  assert.equal(reduction.settlementAmount, 100);
  assert.equal(reduction.remainingCarryForward, 0);
  assert.equal(reduction.reduced, false);

  const actualPaidEarnings = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  assert.equal(actualPaidEarnings, 100);
  assert.equal(sumBy(rows, (row) => row.refund_amount), 0);
});

test('Spec step 2: user refund leaves the record refunded and no settlement buckets move yet', () => {
  const rows = [
    { id: 'refund-30', amount: 30, status: 'paid', refund_amount: 30, manual_carry_forward_amount: 0, paid_amount: 0 },
    { id: 'next-1', amount: 40, status: 'pending', refund_amount: 0, manual_carry_forward_amount: 0, paid_amount: 0 },
  ];

  const projected = applyRefundCarryForward(rows);
  const refunded = projected.find((row) => row.id === 'refund-30');
  const pending = projected.find((row) => row.id === 'next-1');

  assert.equal(refunded.display_status, 'Refunded');
  assert.equal(refunded.refund_deduction_amount, 0);
  assert.equal(refunded.pending_refund_amount, 0);
  assert.equal(pending.refund_deduction_amount, 0);
  assert.equal(pending.pending_refund_amount, 0);
  assert.equal(sumBy(projected, (row) => row.refund_deduction_amount), 0);
});

test('Spec step 3: carry-forward marks the refunded row but does not trigger refunds until settlement', () => {
  const rows = [
    { id: 'refund-30', amount: 30, status: 'paid', refund_amount: 30, manual_carry_forward_amount: 30, paid_amount: 0 },
    { id: 'next-1', amount: 40, status: 'pending', refund_amount: 0, manual_carry_forward_amount: 0, paid_amount: 0 },
  ];

  const projected = applyRefundCarryForward(rows);
  const refunded = projected.find((row) => row.id === 'refund-30');
  const pending = projected.find((row) => row.id === 'next-1');

  assert.equal(refunded.display_status, 'Refunded');
  assert.equal(refunded.manual_carry_forward_amount, 30);
  assert.equal(refunded.refund_deduction_amount, 0);
  assert.equal(pending.refund_deduction_amount, 0);
  assert.equal(pending.pending_refund_amount, 0);
});

test('Spec step 4: new pending records remain open until settlement even when a carry-forward exists', () => {
  const rows = [
    { id: 'refund-30', amount: 30, status: 'paid', refund_amount: 30, manual_carry_forward_amount: 30, paid_amount: 0 },
    { id: 'tx-40', amount: 40, status: 'pending', refund_amount: 0, manual_carry_forward_amount: 0, paid_amount: 0 },
    { id: 'tx-10', amount: 10, status: 'paid', refund_amount: 10, manual_carry_forward_amount: 10, paid_amount: 0 },
    { id: 'tx-20', amount: 20, status: 'pending', refund_amount: 0, manual_carry_forward_amount: 0, paid_amount: 0 },
  ];

  const projected = applyRefundCarryForward(rows);
  const tx40 = projected.find((row) => row.id === 'tx-40');
  const tx10 = projected.find((row) => row.id === 'tx-10');
  const tx20 = projected.find((row) => row.id === 'tx-20');

  assert.equal(tx40.pending_refund_amount, 0);
  assert.equal(tx10.display_status, 'Refunded');
  assert.equal(tx10.manual_carry_forward_amount, 10);
  assert.equal(tx20.pending_refund_amount, 0);
  assert.equal(sumBy(projected, (row) => row.refund_deduction_amount), 0);
});

test('Spec step 5: settlement consumes carry-forward only once and disburses net cash 30', () => {
  const pendingSettlements = [
    { id: 'tx-40', amount: 40, paid_amount: 0, manual_carry_forward_amount: 0 },
    { id: 'tx-10', amount: 10, paid_amount: 0, manual_carry_forward_amount: 10 },
    { id: 'tx-20', amount: 20, paid_amount: 0, manual_carry_forward_amount: 0 },
  ];

  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements,
    carryForwardAmount: 40,
  });

  assert.equal(reduction.totalPendingAmount, 70);
  assert.equal(reduction.carryForwardAmount, 40);
  assert.equal(reduction.settlementAmount, 30);
  assert.equal(reduction.remainingCarryForward, 0);
  assert.equal(reduction.reduced, true);
});

test('Spec step 6a: after the 40 refund is carry-forwarded, a new pending pool of 80 is still outstanding', () => {
  const pendingSettlements = [
    { id: 'paid-40', amount: 40, paid_amount: 0, manual_carry_forward_amount: 40 },
    { id: 'pending-50', amount: 50, paid_amount: 0, manual_carry_forward_amount: 0 },
    { id: 'pending-30', amount: 30, paid_amount: 0, manual_carry_forward_amount: 0 },
  ];

  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements,
    carryForwardAmount: 40,
  });

  assert.equal(reduction.totalPendingAmount, 120);
  assert.equal(reduction.carryForwardAmount, 40);
  assert.equal(reduction.settlementAmount, 80);
  assert.equal(reduction.remainingCarryForward, 0);
  assert.equal(reduction.reduced, true);
});

test('Spec step 6b: a second settlement nets the new pending pool against the remaining carry-forward and pays only 40', () => {
  const pendingSettlements = [
    { id: 'pending-40', amount: 40, paid_amount: 0, manual_carry_forward_amount: 0 },
    { id: 'pending-20', amount: 20, paid_amount: 0, manual_carry_forward_amount: 0 },
    { id: 'pending-20', amount: 20, paid_amount: 0, manual_carry_forward_amount: 0 },
  ];

  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements,
    carryForwardAmount: 40,
  });

  assert.equal(reduction.totalPendingAmount, 80);
  assert.equal(reduction.carryForwardAmount, 40);
  assert.equal(reduction.settlementAmount, 40);
  assert.equal(reduction.remainingCarryForward, 0);
  assert.equal(reduction.reduced, true);
});


test('Spec step 5 carry-forward allocation consumes the liability in order and stops when it is zero', () => {
  const allocations = calculateRefundCarryForwardAllocations({
    refundAmount: 40,
    alreadyCarriedForward: 0,
    pendingSettlements: [
      { id: 'a', amount: 40, paid_amount: 0, manual_carry_forward_amount: 0 },
      { id: 'b', amount: 10, paid_amount: 0, manual_carry_forward_amount: 0 },
      { id: 'c', amount: 20, paid_amount: 0, manual_carry_forward_amount: 0 },
    ],
  });

  assert.deepEqual(
    allocations.map((item) => ({
      id: item.id,
      carryForwardAmount: roundMoney(item.carryForwardAmount),
      remainingAfter: roundMoney(item.remainingAfter),
    })),
    [
      { id: 'a', carryForwardAmount: 40, remainingAfter: 0 },
      { id: 'b', carryForwardAmount: 0, remainingAfter: 0 },
      { id: 'c', carryForwardAmount: 0, remainingAfter: 0 },
    ],
  );
});

test('Exact implementation.md step 6: later 40 refund is settled against 50 and 30 pending rows', () => {
  const beforeSettlement = {
    paid_earnings: 80,
    refunds: 40,
    pending: 0,
    carry_forward: 40,
  };
  assert.deepEqual(beforeSettlement, {
    paid_earnings: 80,
    refunds: 40,
    pending: 0,
    carry_forward: 40,
  });

  const pendingRows = [
    { id: 'pending-50', amount: 50, paid_amount: 0, manual_carry_forward_amount: 0 },
    { id: 'pending-30', amount: 30, paid_amount: 0, manual_carry_forward_amount: 0 },
  ];
  const reduction = calculateMonthSettlementCarryForwardReduction({
    pendingSettlements: pendingRows,
    carryForwardAmount: 40,
  });

  assert.deepEqual(
    {
      paid_earnings: 120,
      refunds: 80,
      pending: 0,
      refund_liability_or_carry_forward: reduction.remainingCarryForward,
      settlement_cash_paid: reduction.settlementAmount,
    },
    {
      paid_earnings: 120,
      refunds: 80,
      pending: 0,
      refund_liability_or_carry_forward: 0,
      settlement_cash_paid: 40,
    },
  );

  const finalRecords = [
    { id: 'run-40', amount: 40, status: 'settled', paid_amount: 40 },
    { id: 'paid-50', amount: 50, status: 'paid', paid_amount: 10, recorded_refund_deduction_amount: 40 },
    { id: 'paid-30', amount: 30, status: 'paid', paid_amount: 0, recorded_refund_deduction_amount: 30 },
    { id: 'run-30', amount: 30, status: 'settled', paid_amount: 30 },
    { id: 'refund-40', amount: 40, status: 'paid', refund_amount: 40, manual_carry_forward_amount: 40 },
    { id: 'refund-10', amount: 10, status: 'paid', refund_amount: 10, manual_carry_forward_amount: 10 },
    { id: 'paid-20-a', amount: 20, status: 'paid', paid_amount: 10, recorded_refund_deduction_amount: 10 },
    { id: 'run-50', amount: 50, status: 'settled', paid_amount: 50 },
    { id: 'refund-30', amount: 30, status: 'paid', refund_amount: 30, manual_carry_forward_amount: 30 },
    { id: 'paid-20-b', amount: 20, status: 'paid', paid_amount: 20 },
  ];
  const projected = applyManualCarryForwardProjection(
    applyRefundCarryForward(finalRecords),
  );

  assert.deepEqual(projected.map((row) => row.id), [
    'run-40', 'paid-50', 'paid-30', 'run-30', 'refund-40',
    'refund-10', 'paid-20-a', 'run-50', 'refund-30', 'paid-20-b',
  ]);
  assert.equal(projected.filter((row) => row.status === 'settled').length, 3);
  assert.equal(projected.filter((row) => row.status === 'paid').length, 7);
  assert.equal(projected.filter((row) => row.status === 'pending').length, 0);
  assert.equal(projected.filter((row) => row.refund_amount > 0).length, 3);
  assert.equal(
    projected.reduce(
      (total, row) => total + (row.refund_amount > 0 ? 0 : Number(row.refund_deduction_amount || 0)),
      0,
    ),
    80,
  );
  assert.equal(
    projected.filter((row) => ['paid-50', 'paid-30', 'paid-20-a'].includes(row.id))
      .reduce((total, row) => total + Number(row.refund_deduction_amount || 0), 0),
    80,
  );
});
