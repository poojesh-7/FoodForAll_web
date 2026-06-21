import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  ActiveIncidentConflict,
  ActiveIncidentConflictResponse,
  AdminOperationalSummary,
  AdminOperationalSummaryResponse,
  AdminProviderSettlementConsoleData,
  AdminProviderSettlementConsoleQuery,
  AdminProviderSettlementConsoleResponse,
  AdminOperationalAlert,
  AdminOperationalAlertsResponse,
  AdminPaymentHealth,
  AdminPaymentHealthResponse,
  AdminQueueHealth,
  AdminQueueHealthResponse,
  AdminSecurityEvent,
  AdminSecurityEventsResponse,
  AddIncidentNoteRequest,
  AddIncidentPostmortemRequest,
  AssignIncidentRequest,
  AuditCenterData,
  AuditCenterQuery,
  AuditCenterResponse,
  BusinessMetricsData,
  BusinessMetricsQuery,
  BusinessMetricsResponse,
  ArchiveComplianceEvidenceResponse,
  ComplianceDashboardData,
  ComplianceDashboardResponse,
  ComplianceDeletionRequestDetail,
  ComplianceDeletionRequestResponse,
  ComplianceQuery,
  ComplianceSubjectType,
  CreateComplianceDeletionRequest,
  CreateIncidentRequest,
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
  IncidentCenterData,
  IncidentCenterResponse,
  IncidentDetailData,
  IncidentDetailResponse,
  IncidentQuery,
  ModerationCaseDetail,
  ModerationAppealsAdminResponse,
  ModerationAppealRow,
  ModerationCaseStatus,
  OperationalMonitoringData,
  OperationalMonitoringQuery,
  OperationalMonitoringResponse,
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
  UpdateComplianceRequestStatus,
  UpdateIncidentStatusRequest,
  UpdateModerationAppealStatusResponse,
  UpdateProviderSettlementNotesRequest,
  UpdateProviderSettlementResponse,
  UpdateProviderSettlementStatusRequest,
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
export type AdminAuditCenter = AuditCenterData;
export type AdminBusinessMetrics = BusinessMetricsData;
export type AdminComplianceDashboard = ComplianceDashboardData;
export type AdminComplianceRequestDetail = ComplianceDeletionRequestDetail;
export type AdminIncidentCenter = IncidentCenterData;
export type AdminIncidentDetail = IncidentDetailData;
export type AdminActiveIncidentConflict = ActiveIncidentConflict;
export type AdminSettlementConsole = AdminProviderSettlementConsoleData;

export type GovernanceIntelligenceParams = {
  windowDays?: number | string;
  limit?: number | string;
  risk?: string;
  reporterId?: DbId;
  providerId?: DbId;
};

export type AuditCenterParams = AuditCenterQuery & {
  domain?: string;
  domains?: string;
};
export type BusinessMetricsParams = BusinessMetricsQuery;
export type ComplianceParams = ComplianceQuery;
export type OperationalMonitoringParams = OperationalMonitoringQuery;
export type IncidentParams = IncidentQuery;

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

export function getActiveIncidentConflict(
  error: unknown
): AdminActiveIncidentConflict | null {
  const responseData = (
    error as {
      response?: {
        data?: ActiveIncidentConflictResponse | unknown;
      };
    }
  )?.response?.data;

  if (
    responseData &&
    typeof responseData === "object" &&
    "code" in responseData &&
    (responseData as { code?: unknown }).code === "ACTIVE_INCIDENT_EXISTS" &&
    "activeIncident" in responseData
  ) {
    const activeIncident = (responseData as ActiveIncidentConflictResponse)
      .activeIncident;
    if (activeIncident?.id && activeIncident.status && activeIncident.title) {
      return activeIncident;
    }
  }

  return null;
}

export async function getOperationalMonitoring(
  params: OperationalMonitoringParams = {}
): Promise<OperationalMonitoringData> {
  const { data } = await api.get<
    OperationalMonitoringResponse | { monitoring: OperationalMonitoringData }
  >("/admin/operations/monitoring", { params });

  return getEnvelopeData<{ monitoring: OperationalMonitoringData }>(data)
    .monitoring;
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

export async function getProviderSettlementConsole(
  params: AdminProviderSettlementConsoleQuery = {}
): Promise<AdminSettlementConsole> {
  const { data } = await api.get<
    AdminProviderSettlementConsoleResponse | { settlements: AdminSettlementConsole }
  >("/admin/settlements", { params });

  return getEnvelopeData<{ settlements: AdminSettlementConsole }>(data)
    .settlements;
}

async function patchProviderSettlement(
  id: DbId,
  action: "paid" | "failed" | "notes",
  payload: UpdateProviderSettlementStatusRequest | UpdateProviderSettlementNotesRequest = {}
): Promise<void> {
  await api.patch<UpdateProviderSettlementResponse | MessageResponse>(
    `/admin/settlements/${String(id)}/${action}`,
    payload
  );
}

export async function markProviderSettlementPaid(
  id: DbId,
  payload: UpdateProviderSettlementStatusRequest
): Promise<void> {
  await patchProviderSettlement(id, "paid", payload);
}

export async function markProviderSettlementFailed(
  id: DbId,
  payload: UpdateProviderSettlementStatusRequest = {}
): Promise<void> {
  await patchProviderSettlement(id, "failed", payload);
}

export async function updateProviderSettlementNotes(
  id: DbId,
  payload: UpdateProviderSettlementNotesRequest
): Promise<void> {
  await patchProviderSettlement(id, "notes", payload);
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

export async function getAuditCenter(
  params: AuditCenterParams = {}
): Promise<AdminAuditCenter> {
  const { data } = await api.get<
    AuditCenterResponse | { audit: AdminAuditCenter }
  >("/admin/audit-center", { params });

  return getEnvelopeData<{ audit: AdminAuditCenter }>(data).audit;
}

function filenameFromDisposition(disposition: unknown, fallback: string) {
  if (typeof disposition !== "string") return fallback;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export async function exportAuditCenter(
  format: "csv" | "json",
  params: AuditCenterParams = {}
): Promise<{ blob: Blob; filename: string }> {
  const response = await api.get<Blob>(`/admin/audit-center/export.${format}`, {
    params,
    responseType: "blob",
  });

  return {
    blob: response.data,
    filename: filenameFromDisposition(
      response.headers["content-disposition"],
      `audit-center-export.${format}`
    ),
  };
}

export async function getBusinessMetrics(
  params: BusinessMetricsParams = {}
): Promise<AdminBusinessMetrics> {
  const { data } = await api.get<
    BusinessMetricsResponse | { metrics: AdminBusinessMetrics }
  >("/admin/business-metrics", { params });

  return getEnvelopeData<{ metrics: AdminBusinessMetrics }>(data).metrics;
}

export async function exportBusinessMetrics(
  format: "csv" | "json",
  params: BusinessMetricsParams = {}
): Promise<{ blob: Blob; filename: string }> {
  const response = await api.get<Blob>(`/admin/business-metrics/export.${format}`, {
    params,
    responseType: "blob",
  });

  return {
    blob: response.data,
    filename: filenameFromDisposition(
      response.headers["content-disposition"],
      `business-metrics-export.${format}`
    ),
  };
}

export async function getComplianceDashboard(
  params: ComplianceParams = {}
): Promise<AdminComplianceDashboard> {
  const { data } = await api.get<
    ComplianceDashboardResponse | { compliance: AdminComplianceDashboard }
  >("/admin/compliance", { params });

  return getEnvelopeData<{ compliance: AdminComplianceDashboard }>(data)
    .compliance;
}

export async function createComplianceDeletionRequest(
  payload: CreateComplianceDeletionRequest
): Promise<AdminComplianceRequestDetail> {
  const { data } = await api.post<
    ComplianceDeletionRequestResponse | { request: AdminComplianceRequestDetail }
  >("/admin/compliance/deletion-requests", payload);

  return getEnvelopeData<{ request: AdminComplianceRequestDetail }>(data).request;
}

export async function getComplianceDeletionRequest(
  id: DbId
): Promise<AdminComplianceRequestDetail> {
  const { data } = await api.get<
    ComplianceDeletionRequestResponse | { request: AdminComplianceRequestDetail }
  >(`/admin/compliance/deletion-requests/${String(id)}`);

  return getEnvelopeData<{ request: AdminComplianceRequestDetail }>(data).request;
}

async function patchComplianceDeletionRequest(
  id: DbId,
  action: "review" | "approve" | "reject" | "execute",
  payload: UpdateComplianceRequestStatus = {}
): Promise<AdminComplianceRequestDetail> {
  const { data } = await api.patch<
    ComplianceDeletionRequestResponse | { request: AdminComplianceRequestDetail }
  >(`/admin/compliance/deletion-requests/${String(id)}/${action}`, payload);

  return getEnvelopeData<{ request: AdminComplianceRequestDetail }>(data).request;
}

export async function reviewComplianceDeletionRequest(
  id: DbId,
  note?: string | null
): Promise<AdminComplianceRequestDetail> {
  return patchComplianceDeletionRequest(id, "review", { note });
}

export async function approveComplianceDeletionRequest(
  id: DbId,
  note?: string | null
): Promise<AdminComplianceRequestDetail> {
  return patchComplianceDeletionRequest(id, "approve", { note });
}

export async function rejectComplianceDeletionRequest(
  id: DbId,
  note?: string | null
): Promise<AdminComplianceRequestDetail> {
  return patchComplianceDeletionRequest(id, "reject", { note });
}

export async function executeComplianceDeletionRequest(
  id: DbId,
  note?: string | null
): Promise<AdminComplianceRequestDetail> {
  return patchComplianceDeletionRequest(id, "execute", { note });
}

export async function archiveComplianceEvidence(
  evidenceType: ComplianceSubjectType | string,
  id: DbId,
  reason?: string | null
): Promise<ArchiveComplianceEvidenceResponse["data"]["evidence"]> {
  const { data } = await api.post<
    ArchiveComplianceEvidenceResponse | ArchiveComplianceEvidenceResponse["data"]
  >(
    `/admin/compliance/evidence/${encodeURIComponent(evidenceType)}/${encodeURIComponent(String(id))}/archive`,
    { reason }
  );

  return getEnvelopeData<ArchiveComplianceEvidenceResponse["data"]>(data).evidence;
}

export async function getIncidents(
  params: IncidentParams = {}
): Promise<AdminIncidentCenter> {
  const { data } = await api.get<
    IncidentCenterResponse | { incidentCenter: AdminIncidentCenter }
  >("/admin/incidents", { params });

  return getEnvelopeData<{ incidentCenter: AdminIncidentCenter }>(data)
    .incidentCenter;
}

export async function getIncident(id: DbId): Promise<AdminIncidentDetail> {
  const { data } = await api.get<
    IncidentDetailResponse | { incident: AdminIncidentDetail }
  >(`/admin/incidents/${String(id)}`);

  return getEnvelopeData<{ incident: AdminIncidentDetail }>(data).incident;
}

export async function createIncident(
  payload: CreateIncidentRequest
): Promise<AdminIncidentDetail> {
  const { data } = await api.post<
    IncidentDetailResponse | { incident: AdminIncidentDetail }
  >("/admin/incidents", payload);

  return getEnvelopeData<{ incident: AdminIncidentDetail }>(data).incident;
}

export async function updateIncidentStatus(
  id: DbId,
  payload: UpdateIncidentStatusRequest
): Promise<AdminIncidentDetail> {
  const { data } = await api.patch<
    IncidentDetailResponse | { incident: AdminIncidentDetail }
  >(`/admin/incidents/${String(id)}/status`, payload);

  return getEnvelopeData<{ incident: AdminIncidentDetail }>(data).incident;
}

export async function assignIncident(
  id: DbId,
  payload: AssignIncidentRequest
): Promise<AdminIncidentDetail> {
  const { data } = await api.patch<
    IncidentDetailResponse | { incident: AdminIncidentDetail }
  >(`/admin/incidents/${String(id)}/assignment`, payload);

  return getEnvelopeData<{ incident: AdminIncidentDetail }>(data).incident;
}

export async function addIncidentNote(
  id: DbId,
  payload: AddIncidentNoteRequest
): Promise<AdminIncidentDetail> {
  const { data } = await api.post<
    IncidentDetailResponse | { incident: AdminIncidentDetail }
  >(`/admin/incidents/${String(id)}/notes`, payload);

  return getEnvelopeData<{ incident: AdminIncidentDetail }>(data).incident;
}

export async function addIncidentPostmortem(
  id: DbId,
  payload: AddIncidentPostmortemRequest
): Promise<AdminIncidentDetail> {
  const { data } = await api.post<
    IncidentDetailResponse | { incident: AdminIncidentDetail }
  >(`/admin/incidents/${String(id)}/postmortem`, payload);

  return getEnvelopeData<{ incident: AdminIncidentDetail }>(data).incident;
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
  getOperationalMonitoring,
  getProviderReports,
  validateProviderReport,
  dismissProviderReport,
  getProviderSettlementConsole,
  markProviderSettlementPaid,
  markProviderSettlementFailed,
  updateProviderSettlementNotes,
  getModerationCase,
  getModerationAppeals,
  getGovernanceDashboard,
  getGovernanceIntelligence,
  getGovernanceReporterReputation,
  getGovernanceProviderMetrics,
  getGovernanceSignals,
  getGovernanceMetrics,
  getGovernanceEscalations,
  getAuditCenter,
  exportAuditCenter,
  getBusinessMetrics,
  exportBusinessMetrics,
  getComplianceDashboard,
  createComplianceDeletionRequest,
  getComplianceDeletionRequest,
  reviewComplianceDeletionRequest,
  approveComplianceDeletionRequest,
  rejectComplianceDeletionRequest,
  executeComplianceDeletionRequest,
  archiveComplianceEvidence,
  getIncidents,
  getIncident,
  createIncident,
  updateIncidentStatus,
  assignIncident,
  addIncidentNote,
  addIncidentPostmortem,
  reviewModerationAppeal,
  acceptModerationAppeal,
  rejectModerationAppeal,
  updateModerationCaseStatus,
  getTrustExplainability,
  recordAdminTrustAction,
  getBullBoardUrl,
  getAssetUrl,
  getActiveIncidentConflict,
  getErrorMessage,
};
