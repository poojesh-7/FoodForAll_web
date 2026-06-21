import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  ProviderFinancialSummaryResponse,
  ProviderPayoutAccount,
  ProviderPayoutAccountsData,
  ProviderPayoutAccountsResponse,
  ProviderSettlementSummaryData,
  SaveProviderPayoutAccountRequest,
  SaveProviderPayoutAccountResponse,
} from "@shared/contracts/api-contracts";

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

export async function getPayoutAccounts(): Promise<ProviderPayoutAccountsData> {
  const { data } = await api.get<
    ProviderPayoutAccountsResponse | ProviderPayoutAccountsData
  >("/provider/financial/payout-account");

  return getEnvelopeData<ProviderPayoutAccountsData>(data);
}

export async function savePayoutAccount(
  payload: SaveProviderPayoutAccountRequest
): Promise<ProviderPayoutAccount | null> {
  const { data } = await api.post<
    SaveProviderPayoutAccountResponse | { account: ProviderPayoutAccount | null }
  >("/provider/financial/payout-account", payload);

  return getEnvelopeData<{ account: ProviderPayoutAccount | null }>(data).account;
}

export async function deactivatePayoutAccount(): Promise<ProviderPayoutAccount | null> {
  const { data } = await api.delete<
    SaveProviderPayoutAccountResponse | { account: ProviderPayoutAccount | null }
  >("/provider/financial/payout-account");

  return getEnvelopeData<{ account: ProviderPayoutAccount | null }>(data).account;
}

export async function getSettlementSummary(): Promise<ProviderSettlementSummaryData> {
  const { data } = await api.get<
    ProviderFinancialSummaryResponse | { summary: ProviderSettlementSummaryData }
  >("/provider/financial/settlements");

  return getEnvelopeData<{ summary: ProviderSettlementSummaryData }>(data).summary;
}

export const providerFinancialService = {
  getPayoutAccounts,
  savePayoutAccount,
  deactivatePayoutAccount,
  getSettlementSummary,
  getErrorMessage,
};
