import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  AdminOperationalSummary,
  AdminOperationalSummaryResponse,
  AdminOperationalAlert,
  AdminOperationalAlertsResponse,
  AdminPaymentHealth,
  AdminPaymentHealthResponse,
  AdminQueueHealth,
  AdminQueueHealthResponse,
  AdminSecurityEvent,
  AdminSecurityEventsResponse,
  DbId,
  GovernanceEscalationAnalytics,
  GovernanceEscalationResponse,
  GovernanceDashboardData,
  GovernanceDashboardResponse,
  GovernanceIntelligenceData,
  GovernanceIntelligenceResponse,
  GovernanceModerationMetrics,
  GovernanceModerationMetricsResponse,
  GovernanceProviderMetrics,
  GovernanceProviderMetricsResponse,
  GovernanceReporterReputation,
  GovernanceReporterReputationResponse,
  GovernanceSignal,
  GovernanceSignalsResponse,
  GetModerationCaseResponse,
  ModerationCaseDetail,
  ModerationAppealsAdminResponse,
  ModerationAppealRow,
  ModerationCaseStatus,
  PendingNGORow,
  PendingNGOsResponse,
  PendingRestaurantRow,
  PendingRestaurantsResponse,
  ProviderReportAttachmentRow,
  GetTrustExplainabilityData,
  GetTrustExplainabilityResponse,
  RecordAdminTrustActionData,
  RecordAdminTrustActionRequest,
  RecordAdminTrustActionResponse,
  TrustExplainability,
  TrustSubjectType,
  UpdateModerationAppealStatusResponse,
} from "@shared/contracts/api-contracts";

export type AdminNGO = PendingNGORow & {
  id?: DbId;
  user_id?: DbId;
  organization_name?: string | null;
  registration_number?: string | null;
  service_radius_km?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  is_verified?: boolean | null;
  rejection_reason?: string | null;
  created_at?: string | null;
};

export type AdminRestaurant = PendingRestaurantRow & {
  id?: DbId;
  user_id?: DbId;
  restaurant_name?: string | null;
  fssai_number?: string | null;
  fssai_certificate_url?: string | null;
  service_radius_km?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  is_verified?: boolean | null;
  rejection_reason?: string | null;
  created_at?: string | null;
};

type MessageResponse = { message?: string };

export type AdminProviderReport = {
  id: DbId;
  provider_id: DbId;
  reported_by: DbId;
  reservation_id?: DbId | null;
  moderation_case_id?: DbId | null;
  moderation_case_status?: ModerationCaseStatus | string | null;
  reason: string;
  description?: string | null;
  status: string;
  created_at?: string;
  provider_name?: string | null;
  reporter_name?: string | null;
  reporter_role?: string | null;
  reservation_pickup_type?: string | null;
  reservation_status?: string | null;
  reservation_task_status?: string | null;
  listing_title?: string | null;
  attachments?: ProviderReportAttachmentRow[];
};
export type AdminModerationCase = ModerationCaseDetail;
export type AdminModerationAppeal = ModerationAppealRow;
export type AdminGovernanceIntelligence = GovernanceIntelligenceData;
export type AdminGovernanceDashboard = GovernanceDashboardData;

export type GovernanceIntelligenceParams = {
  windowDays?: number | string;
  limit?: number | string;
  risk?: string;
  reporterId?: DbId;
  providerId?: DbId;
};

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

export function getBullBoardUrl() {
  return `${getBackendOrigin()}/admin/queues`;
}

export function getAssetUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${getBackendOrigin()}/${path.replace(/^\/+/, "").replaceAll("\\", "/")}`;
}

export async function getPendingNGOs(): Promise<AdminNGO[]> {
  const { data } = await api.get<PendingNGOsResponse | AdminNGO[]>(
    "/admin/ngos/pending"
  );

  return getEnvelopeData<AdminNGO[]>(data);
}

export async function approveNGO(id: DbId): Promise<void> {
  await api.patch<MessageResponse>(`/admin/ngos/${String(id)}/approve`);
}

export async function rejectNGO(id: DbId, reason: string): Promise<void> {
  await api.patch<MessageResponse>(`/admin/ngos/${String(id)}/reject`, { reason });
}

export async function getPendingRestaurants(): Promise<AdminRestaurant[]> {
  const { data } = await api.get<PendingRestaurantsResponse | AdminRestaurant[]>(
    "/admin/restaurants/pending"
  );

  return getEnvelopeData<AdminRestaurant[]>(data);
}

export async function approveRestaurant(id: DbId): Promise<void> {
  await api.patch<MessageResponse>(`/admin/restaurants/${String(id)}/approve`);
}

export async function rejectRestaurant(id: DbId, reason: string): Promise<void> {
  await api.patch<MessageResponse>(
    `/admin/restaurants/${String(id)}/reject`,
    { reason }
  );
}

export async function getOperationalSummary(): Promise<AdminOperationalSummary> {
  const { data } = await api.get<
    AdminOperationalSummaryResponse | AdminOperationalSummary
  >("/admin/operations/summary");

  return getEnvelopeData<AdminOperationalSummary>(data);
}

export async function getQueueHealth(): Promise<AdminQueueHealth[]> {
  const { data } = await api.get<
    AdminQueueHealthResponse | { queues: AdminQueueHealth[] }
  >("/admin/queues/health");

  return getEnvelopeData<{ queues: AdminQueueHealth[] }>(data).queues;
}

export async function retryFailedQueueJob(
  queueName: string,
  jobId: string | number
): Promise<void> {
  await api.post(
    `/admin/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(
      String(jobId)
    )}/retry`
  );
}

export async function getPaymentHealth(): Promise<AdminPaymentHealth> {
  const { data } = await api.get<
    AdminPaymentHealthResponse | { payments: AdminPaymentHealth }
  >("/admin/payments/health");

  return getEnvelopeData<{ payments: AdminPaymentHealth }>(data).payments;
}

export async function getOperationalAlerts(): Promise<AdminOperationalAlert[]> {
  const { data } = await api.get<
    AdminOperationalAlertsResponse | { alerts: AdminOperationalAlert[] }
  >("/admin/operations/alerts");

  return getEnvelopeData<{ alerts: AdminOperationalAlert[] }>(data).alerts;
}

export async function getSecurityEvents(): Promise<AdminSecurityEvent[]> {
  const { data } = await api.get<
    AdminSecurityEventsResponse | { events: AdminSecurityEvent[] }
  >("/admin/operations/security-events");

  return getEnvelopeData<{ events: AdminSecurityEvent[] }>(data).events;
}

export async function getProviderReports(
  status: "pending" | "all" = "pending"
): Promise<AdminProviderReport[]> {
  const { data } = await api.get<
    { reports: AdminProviderReport[] } | { data: { reports: AdminProviderReport[] } }
  >("/admin/provider-reports", { params: { status } });

  return getEnvelopeData<{ reports: AdminProviderReport[] }>(data).reports;
}

export async function validateProviderReport(id: DbId): Promise<void> {
  await api.patch<MessageResponse>(`/admin/provider-reports/${String(id)}/validate`);
}

export async function dismissProviderReport(id: DbId): Promise<void> {
  await api.patch<MessageResponse>(`/admin/provider-reports/${String(id)}/dismiss`);
}

export async function getModerationCase(id: DbId): Promise<AdminModerationCase> {
  const { data } = await api.get<
    GetModerationCaseResponse | { case: AdminModerationCase }
  >(`/admin/moderation-cases/${String(id)}`);

  return getEnvelopeData<{ case: AdminModerationCase }>(data).case;
}

export async function getModerationAppeals(
  status: "open" | "all" | string = "open"
): Promise<AdminModerationAppeal[]> {
  const { data } = await api.get<
    ModerationAppealsAdminResponse | { appeals: AdminModerationAppeal[] }
  >("/admin/moderation-appeals", { params: { status } });

  return getEnvelopeData<{ appeals: AdminModerationAppeal[] }>(data).appeals;
}

export async function getGovernanceIntelligence(
  params: GovernanceIntelligenceParams = {}
): Promise<GovernanceIntelligenceData> {
  const { data } = await api.get<
    GovernanceIntelligenceResponse | { intelligence: GovernanceIntelligenceData }
  >("/admin/governance-intelligence", { params });

  return getEnvelopeData<{ intelligence: GovernanceIntelligenceData }>(data)
    .intelligence;
}

export async function getGovernanceDashboard(
  params: GovernanceIntelligenceParams = {}
): Promise<GovernanceDashboardData> {
  const { data } = await api.get<
    GovernanceDashboardResponse | { dashboard: GovernanceDashboardData }
  >("/admin/governance-dashboard", { params });

  return getEnvelopeData<{ dashboard: GovernanceDashboardData }>(data).dashboard;
}

export async function getGovernanceReporterReputation(
  params: GovernanceIntelligenceParams = {}
): Promise<GovernanceReporterReputation[]> {
  const { data } = await api.get<
    GovernanceReporterReputationResponse | { reporters: GovernanceReporterReputation[] }
  >("/admin/governance-intelligence/reporters", { params });

  return getEnvelopeData<{ reporters: GovernanceReporterReputation[] }>(data)
    .reporters;
}

export async function getGovernanceProviderMetrics(
  params: GovernanceIntelligenceParams = {}
): Promise<GovernanceProviderMetrics[]> {
  const { data } = await api.get<
    GovernanceProviderMetricsResponse | { providers: GovernanceProviderMetrics[] }
  >("/admin/governance-intelligence/providers", { params });

  return getEnvelopeData<{ providers: GovernanceProviderMetrics[] }>(data)
    .providers;
}

export async function getGovernanceSignals(
  params: GovernanceIntelligenceParams = {}
): Promise<GovernanceSignal[]> {
  const { data } = await api.get<
    GovernanceSignalsResponse | { signals: GovernanceSignal[] }
  >("/admin/governance-intelligence/signals", { params });

  return getEnvelopeData<{ signals: GovernanceSignal[] }>(data).signals;
}

export async function getGovernanceMetrics(
  params: GovernanceIntelligenceParams = {}
): Promise<GovernanceModerationMetrics> {
  const { data } = await api.get<
    GovernanceModerationMetricsResponse | { metrics: GovernanceModerationMetrics }
  >("/admin/governance-intelligence/metrics", { params });

  return getEnvelopeData<{ metrics: GovernanceModerationMetrics }>(data).metrics;
}

export async function getGovernanceEscalations(
  params: GovernanceIntelligenceParams = {}
): Promise<GovernanceEscalationAnalytics> {
  const { data } = await api.get<
    GovernanceEscalationResponse | { escalation: GovernanceEscalationAnalytics }
  >("/admin/governance-intelligence/escalations", { params });

  return getEnvelopeData<{ escalation: GovernanceEscalationAnalytics }>(data)
    .escalation;
}

async function patchModerationAppeal(
  id: DbId,
  action: "review" | "accept" | "reject",
  note?: string | null
): Promise<{ appeal: AdminModerationAppeal; case: AdminModerationCase }> {
  const { data } = await api.patch<
    | UpdateModerationAppealStatusResponse
    | { appeal: AdminModerationAppeal; case: AdminModerationCase }
  >(`/admin/moderation-appeals/${String(id)}/${action}`, { note });

  return getEnvelopeData<{
    appeal: AdminModerationAppeal;
    case: AdminModerationCase;
  }>(data);
}

export async function reviewModerationAppeal(
  id: DbId,
  note?: string | null
): Promise<{ appeal: AdminModerationAppeal; case: AdminModerationCase }> {
  return patchModerationAppeal(id, "review", note);
}

export async function acceptModerationAppeal(
  id: DbId,
  note?: string | null
): Promise<{ appeal: AdminModerationAppeal; case: AdminModerationCase }> {
  return patchModerationAppeal(id, "accept", note);
}

export async function rejectModerationAppeal(
  id: DbId,
  note?: string | null
): Promise<{ appeal: AdminModerationAppeal; case: AdminModerationCase }> {
  return patchModerationAppeal(id, "reject", note);
}

export async function updateModerationCaseStatus(
  id: DbId,
  status: ModerationCaseStatus,
  note?: string | null
): Promise<AdminModerationCase> {
  const { data } = await api.patch<
    { case: AdminModerationCase } | { data: { case: AdminModerationCase } }
  >(`/admin/moderation-cases/${String(id)}/status`, { status, note });

  return getEnvelopeData<{ case: AdminModerationCase }>(data).case;
}

export async function getTrustExplainability(
  subjectType: TrustSubjectType | string,
  subjectId: DbId
): Promise<TrustExplainability> {
  const { data } = await api.get<
    GetTrustExplainabilityResponse | GetTrustExplainabilityData
  >(`/admin/trust/${encodeURIComponent(subjectType)}/${encodeURIComponent(String(subjectId))}/explain`);

  return getEnvelopeData<GetTrustExplainabilityData>(data).explanation;
}

export async function recordAdminTrustAction(
  subjectType: TrustSubjectType | string,
  subjectId: DbId,
  payload: RecordAdminTrustActionRequest
): Promise<RecordAdminTrustActionData> {
  const { data } = await api.post<
    RecordAdminTrustActionResponse | RecordAdminTrustActionData
  >(
    `/admin/trust/${encodeURIComponent(subjectType)}/${encodeURIComponent(String(subjectId))}/actions`,
    payload
  );

  return getEnvelopeData<RecordAdminTrustActionData>(data);
}

export const adminService = {
  getPendingNGOs,
  approveNGO,
  rejectNGO,
  getPendingRestaurants,
  approveRestaurant,
  rejectRestaurant,
  getOperationalSummary,
  getQueueHealth,
  retryFailedQueueJob,
  getPaymentHealth,
  getOperationalAlerts,
  getSecurityEvents,
  getProviderReports,
  validateProviderReport,
  dismissProviderReport,
  getModerationCase,
  getModerationAppeals,
  getGovernanceDashboard,
  getGovernanceIntelligence,
  getGovernanceReporterReputation,
  getGovernanceProviderMetrics,
  getGovernanceSignals,
  getGovernanceMetrics,
  getGovernanceEscalations,
  reviewModerationAppeal,
  acceptModerationAppeal,
  rejectModerationAppeal,
  updateModerationCaseStatus,
  getTrustExplainability,
  recordAdminTrustAction,
  getBullBoardUrl,
  getAssetUrl,
  getErrorMessage,
};
