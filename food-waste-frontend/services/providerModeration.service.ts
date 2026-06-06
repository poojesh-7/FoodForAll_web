import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  DbId,
  ModerationCaseDetail,
  ProviderModerationCaseResponse,
  ProviderModerationCaseSummary,
  ProviderModerationCasesResponse,
  SubmitProviderCaseResponseResponse,
  SubmitProviderModerationAppealResponse,
  WithdrawProviderModerationAppealResponse,
} from "@shared/contracts/api-contracts";

type ProviderResponsePayload = {
  response_text: string;
  attachments?: File[];
};

type ProviderAppealPayload = {
  appeal_text: string;
  attachments?: File[];
};

function encodeId(id: DbId) {
  return encodeURIComponent(String(id));
}

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

function getApiBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  const baseUrl = configuredUrl || "http://localhost:5000/api/v1";
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
}

export function getBackendOrigin() {
  const baseUrl = getApiBaseUrl();

  try {
    const url = new URL(baseUrl);
    return url.origin;
  } catch {
    return "http://localhost:5000";
  }
}

export function getAssetUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${getBackendOrigin()}/${path.replace(/^\/+/, "").replaceAll("\\", "/")}`;
}

export async function getProviderModerationCases(): Promise<
  ProviderModerationCaseSummary[]
> {
  const { data } = await api.get<
    ProviderModerationCasesResponse | { cases: ProviderModerationCaseSummary[] }
  >("/provider/moderation-cases");

  return getEnvelopeData<{ cases: ProviderModerationCaseSummary[] }>(data).cases;
}

export async function getProviderModerationCase(
  id: DbId
): Promise<ModerationCaseDetail> {
  const { data } = await api.get<
    ProviderModerationCaseResponse | { case: ModerationCaseDetail }
  >(`/provider/moderation-cases/${encodeId(id)}`);

  return getEnvelopeData<{ case: ModerationCaseDetail }>(data).case;
}

export async function submitProviderCaseResponse(
  id: DbId,
  payload: ProviderResponsePayload
): Promise<ModerationCaseDetail> {
  const attachments = payload.attachments?.filter(Boolean) ?? [];
  const formData = new FormData();
  formData.append("response_text", payload.response_text);
  attachments.forEach((file) => {
    formData.append("attachments", file);
  });

  const { data } = await api.post<
    SubmitProviderCaseResponseResponse | { case: ModerationCaseDetail }
  >(`/provider/moderation-cases/${encodeId(id)}/response`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return getEnvelopeData<{ case: ModerationCaseDetail }>(data).case;
}

export async function submitProviderModerationAppeal(
  id: DbId,
  payload: ProviderAppealPayload
): Promise<ModerationCaseDetail> {
  const attachments = payload.attachments?.filter(Boolean) ?? [];
  const formData = new FormData();
  formData.append("appeal_text", payload.appeal_text);
  attachments.forEach((file) => {
    formData.append("attachments", file);
  });

  const { data } = await api.post<
    SubmitProviderModerationAppealResponse | { case: ModerationCaseDetail }
  >(`/provider/moderation-cases/${encodeId(id)}/appeal`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return getEnvelopeData<{ case: ModerationCaseDetail }>(data).case;
}

export async function withdrawProviderModerationAppeal(
  id: DbId
): Promise<ModerationCaseDetail> {
  const { data } = await api.patch<
    WithdrawProviderModerationAppealResponse | { case: ModerationCaseDetail }
  >(`/provider/moderation-cases/${encodeId(id)}/appeal/withdraw`);

  return getEnvelopeData<{ case: ModerationCaseDetail }>(data).case;
}

export const providerModerationService = {
  getProviderModerationCases,
  getProviderModerationCase,
  submitProviderCaseResponse,
  submitProviderModerationAppeal,
  withdrawProviderModerationAppeal,
  getAssetUrl,
  getErrorMessage,
};
