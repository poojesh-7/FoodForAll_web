import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  ProviderFinancialSummaryResponse,
  ProviderPayoutAccount,
  ProviderPayoutAccountsData,
  ProviderPayoutAccountsResponse,
  ProviderSettlementSummaryData,
  RequestProviderPayoutAccountChangeRequest,
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

export async function requestPayoutAccountChange(
  payload: RequestProviderPayoutAccountChangeRequest,
): Promise<ProviderPayoutAccount | null> {
  const { data } = await api.post<
    SaveProviderPayoutAccountResponse | { account: ProviderPayoutAccount | null }
  >("/provider/financial/payout-account/change-request", payload);

  return getEnvelopeData<{ account: ProviderPayoutAccount | null }>(data).account;
}

export async function getSettlementSummary(): Promise<ProviderSettlementSummaryData> {
  const { data } = await api.get<
    ProviderFinancialSummaryResponse | { summary: ProviderSettlementSummaryData }
  >("/provider/financial/settlements");

  return getEnvelopeData<{ summary: ProviderSettlementSummaryData }>(data).summary;
}

export async function getSettlementRecords(params: {
  year?: number;
  month?: number;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ records: any[]; limit: number; offset: number; count: number }> {
  const { data } = await api.get("/provider/financial/settlements/records", {
    params,
  });

  const payload = getEnvelopeData<any>(data);

  // Normalize response shapes:
  // 1) { records: [...], limit, offset, count }
  // 2) { records: { records: [...], limit, offset, count } } (backend nested)
  // 3) [...] (array)

  if (payload && Array.isArray(payload.records)) {
    return {
      records: payload.records,
      limit: Number(payload.limit || payload.records.length || 0),
      offset: Number(payload.offset || 0),
      count: Number(payload.count || payload.records.length || 0),
    };
  }

  if (payload && payload.records && Array.isArray(payload.records.records)) {
    const inner = payload.records;
    return {
      records: inner.records,
      limit: Number(inner.limit || inner.records.length || 0),
      offset: Number(inner.offset || 0),
      count: Number(inner.count || inner.records.length || 0),
    };
  }

  if (Array.isArray(payload)) {
    return { records: payload, limit: payload.length, offset: 0, count: payload.length };
  }

  return { records: [], limit: 0, offset: 0, count: 0 };
}

export const providerFinancialService = {
  getPayoutAccounts,
  savePayoutAccount,
  deactivatePayoutAccount,
  requestPayoutAccountChange,
  getSettlementSummary,
  getSettlementRecords,
  getErrorMessage,
};
