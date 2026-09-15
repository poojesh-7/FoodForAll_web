export function getSettlementMetricTotals(
  providerSummary: Array<{
    amount_due?: number | string | null;
    pending_settlements?: number | string | null;
  }> = [],
) {
  const totalAmountDue = providerSummary.reduce((sum, row) => {
    const amountDue = Number(row?.amount_due ?? 0);
    return sum + (Number.isFinite(amountDue) ? amountDue : 0);
  }, 0);

  const pendingSettlementCount = providerSummary.reduce((sum, row) => {
    const pendingSettlements = Number(row?.pending_settlements ?? 0);
    return sum + (Number.isFinite(pendingSettlements) ? pendingSettlements : 0);
  }, 0);

  return {
    totalAmountDue,
    pendingSettlementCount,
  };
}

export function getAmountDueForDisplay({
  globalRows = [],
  selectedProviderId,
  selectedProviderGrossPendingAmount,
}: {
  globalRows?: Array<{ amount_due?: number | string | null; pending_settlements?: number | string | null }>;
  selectedProviderId?: string | null;
  selectedProviderGrossPendingAmount?: number | string | null;
}) {
  if (selectedProviderId && selectedProviderGrossPendingAmount !== undefined && selectedProviderGrossPendingAmount !== null) {
    return Number(selectedProviderGrossPendingAmount || 0);
  }

  return getSettlementMetricTotals(globalRows).totalAmountDue;
}
