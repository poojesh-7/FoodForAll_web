import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAmountDueForDisplay,
  getSettlementMetricTotals,
} from '../app/admin/settlements/settlementMetrics.ts';

test('aggregate totals remain correct when no provider is selected', () => {
  const rows = [
    { provider_id: 1, amount_due: 120, pending_settlements: 2 },
    { provider_id: 2, amount_due: 80, pending_settlements: 1 },
  ];

  const metrics = getSettlementMetricTotals(rows);

  assert.equal(metrics.totalAmountDue, 200);
  assert.equal(metrics.pendingSettlementCount, 3);
  assert.equal(getAmountDueForDisplay({ globalRows: rows }), 200);
});

test('selected provider uses the canonical gross pending amount instead of the aggregate total', () => {
  const rows = [
    { provider_id: 1, amount_due: 120, pending_settlements: 2 },
    { provider_id: 2, amount_due: 80, pending_settlements: 1 },
  ];

  assert.equal(
    getAmountDueForDisplay({
      globalRows: rows,
      selectedProviderId: '1',
      selectedProviderGrossPendingAmount: 114,
    }),
    114,
  );
});
