import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  DbId,
  ImpactSummary,
  ImpactSummaryResponse,
} from "@shared/contracts/api-contracts";

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

export function toMetricNumber(value: unknown): number {
  const metric = Number(value ?? 0);
  return Number.isFinite(metric) ? metric : 0;
}

export function formatMetric(value: unknown, fractionDigits = 0): string {
  const metric = toMetricNumber(value);
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: fractionDigits,
  }).format(metric);
}

export async function getPlatformImpact(): Promise<ImpactSummary> {
  const { data } = await api.get<ImpactSummaryResponse | ImpactSummary>(
    "/impact/summary"
  );

  return getEnvelopeData<ImpactSummary>(data);
}

export async function getUserImpact(userId: DbId): Promise<ImpactSummary> {
  const { data } = await api.get<ImpactSummaryResponse | ImpactSummary>(
    `/impact/user/${String(userId)}`
  );

  return getEnvelopeData<ImpactSummary>(data);
}

export async function getListingImpact(listingId: DbId): Promise<ImpactSummary> {
  const { data } = await api.get<ImpactSummaryResponse | ImpactSummary>(
    `/impact/listing/${String(listingId)}`
  );

  return getEnvelopeData<ImpactSummary>(data);
}

export async function getNGOImpact(ngoId: DbId): Promise<ImpactSummary> {
  const { data } = await api.get<ImpactSummaryResponse | ImpactSummary>(
    `/impact/ngo/${String(ngoId)}`
  );

  return getEnvelopeData<ImpactSummary>(data);
}

export const impactService = {
  getPlatformImpact,
  getUserImpact,
  getListingImpact,
  getNGOImpact,
  toMetricNumber,
  formatMetric,
  getErrorMessage,
};
