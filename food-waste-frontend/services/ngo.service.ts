import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  AcceptNGORequestResponse,
  AcceptNGORequestData,
  BulkReserveData,
  BulkReserveRequest,
  BulkReserveResponse,
  DbRow,
  DbId,
  ImpactSummary,
  ImpactSummaryResponse,
  ApproveVolunteerJoinRequestResponse,
  NGOAssignedVolunteer,
  NGOAssignedVolunteersResponse,
  NGOIncomingRequest,
  NGOIncomingRequestsResponse,
  NGOVolunteerJoinRequest,
  NGOVolunteerJoinRequestsResponse,
  NGORegistration,
  NGOReservationHistoryRow,
  NGOReservationsResponse,
  NGOProfile,
  NGOUnassignedVolunteer,
  NGOUnassignedVolunteersResponse,
  NearbyFoodListing,
  NGONearbyListingsResponse,
  RegisterNGOData,
  RegisterNGORequest,
  RegisterNGOResponse,
  RejectNGORequestResponse,
  RejectVolunteerJoinRequestResponse,
  RequestVolunteerRequest,
  RequestVolunteerResponse,
  ReservationPricingPreview,
  ReservationPricingPreviewResponse,
  SetUrgentRequest,
  SetUrgentResponse,
} from "@shared/contracts/api-contracts";

type LegacyRegisterNGOResponse = {
  message?: string;
  ngo: NGORegistration;
};
type MessageResponse = { message?: string };
type LegacyNGOReservationsResponse = {
  reservations: NGOReservationHistoryRow[];
};
type MyNGOProfile = NGOProfile & DbRow;
type LegacyBulkReserveResponse = BulkReserveData;
function getNGOData(body: RegisterNGOResponse | LegacyRegisterNGOResponse): RegisterNGOData {
  if ("data" in body) return body.data;
  return { ngo: body.ngo };
}

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

export async function registerNGO(
  payload: RegisterNGORequest
): Promise<RegisterNGOData> {
  const { data } = await api.post<RegisterNGOResponse | LegacyRegisterNGOResponse>(
    "/ngos/register",
    payload
  );

  return getNGOData(data);
}

export async function getMyNGO(): Promise<MyNGOProfile> {
  const { data } = await api.get<{ data: MyNGOProfile } | MyNGOProfile>("/ngos/me");
  return getEnvelopeData<MyNGOProfile>(data);
}

export async function getNearbyListings(params: {
  lat: string | number;
  lng: string | number;
}): Promise<NearbyFoodListing[]> {
  const { data } = await api.get<NGONearbyListingsResponse | NearbyFoodListing[]>(
    "/ngos/listings/nearby",
    { params }
  );

  return getEnvelopeData<NearbyFoodListing[]>(data);
}

export async function bulkReserve(
  payload: BulkReserveRequest
): Promise<BulkReserveData> {
  const { data } = await api.post<BulkReserveResponse | LegacyBulkReserveResponse>(
    "/ngos/bulk-reserve",
    payload
  );

  return getEnvelopeData<BulkReserveData>(data);
}

export async function previewBulkReserve(
  payload: BulkReserveRequest
): Promise<ReservationPricingPreview> {
  const { data } = await api.post<
    ReservationPricingPreviewResponse | ReservationPricingPreview
  >("/ngos/bulk-reserve/preview", payload);

  return getEnvelopeData<ReservationPricingPreview>(data);
}

export async function getAssignedVolunteers(): Promise<NGOAssignedVolunteer[]> {
  const { data } = await api.get<
    NGOAssignedVolunteersResponse | NGOAssignedVolunteer[]
  >("/ngos/volunteers/assigned");

  return getEnvelopeData<NGOAssignedVolunteer[]>(data);
}

export async function getUnassignedVolunteers(): Promise<NGOUnassignedVolunteer[]> {
  const { data } = await api.get<
    NGOUnassignedVolunteersResponse | NGOUnassignedVolunteer[]
  >("/ngos/volunteers");

  return getEnvelopeData<NGOUnassignedVolunteer[]>(data);
}

export async function requestVolunteer(
  payload: RequestVolunteerRequest
): Promise<void> {
  await api.post<RequestVolunteerResponse | MessageResponse>(
    "/ngos/request-volunteer",
    payload
  );
}

export async function getVolunteerJoinRequests(): Promise<NGOVolunteerJoinRequest[]> {
  const { data } = await api.get<
    NGOVolunteerJoinRequestsResponse | NGOVolunteerJoinRequest[]
  >("/ngos/volunteer-join-requests");

  return getEnvelopeData<NGOVolunteerJoinRequest[]>(data);
}

export async function approveVolunteerJoinRequest(requestId: DbId): Promise<void> {
  await api.put<ApproveVolunteerJoinRequestResponse | MessageResponse>(
    `/ngos/volunteer-join-requests/${String(requestId)}/approve`
  );
}

export async function rejectVolunteerJoinRequest(requestId: DbId): Promise<void> {
  await api.put<RejectVolunteerJoinRequestResponse | MessageResponse>(
    `/ngos/volunteer-join-requests/${String(requestId)}/reject`
  );
}

export async function setUrgent(payload: SetUrgentRequest): Promise<void> {
  await api.put<SetUrgentResponse | MessageResponse>("/ngos/urgent", payload);
}

export async function getIncomingRequests(): Promise<NGOIncomingRequest[]> {
  const { data } = await api.get<NGOIncomingRequestsResponse | NGOIncomingRequest[]>(
    "/ngos/requests"
  );

  return getEnvelopeData<NGOIncomingRequest[]>(data);
}

export async function getReservations(): Promise<NGOReservationHistoryRow[]> {
  const { data } = await api.get<
    NGOReservationsResponse | LegacyNGOReservationsResponse | NGOReservationHistoryRow[]
  >("/ngos/reservations");

  if (Array.isArray(data)) return data;
  if ("reservations" in data) return data.reservations;
  return getEnvelopeData<NGOReservationHistoryRow[]>(data);
}

export async function acceptRequest(requestId: DbId): Promise<AcceptNGORequestData> {
  const { data } = await api.put<
    AcceptNGORequestResponse | AcceptNGORequestData | MessageResponse
  >(
    `/ngos/requests/${String(requestId)}/accept`
  );

  return getEnvelopeData<AcceptNGORequestData>(data as AcceptNGORequestData);
}

export async function rejectRequest(requestId: DbId): Promise<void> {
  await api.put<RejectNGORequestResponse | MessageResponse>(
    `/ngos/requests/${String(requestId)}/reject`
  );
}

export async function getNGOImpact(ngoId: DbId): Promise<ImpactSummary> {
  const { data } = await api.get<ImpactSummaryResponse | ImpactSummary>(
    `/impact/ngo/${String(ngoId)}`
  );

  return getEnvelopeData<ImpactSummary>(data);
}

export const ngoService = {
  registerNGO,
  getMyNGO,
  getNearbyListings,
  bulkReserve,
  previewBulkReserve,
  getAssignedVolunteers,
  getUnassignedVolunteers,
  requestVolunteer,
  getVolunteerJoinRequests,
  approveVolunteerJoinRequest,
  rejectVolunteerJoinRequest,
  setUrgent,
  getIncomingRequests,
  getReservations,
  acceptRequest,
  rejectRequest,
  getNGOImpact,
  getErrorMessage,
};

export type { MyNGOProfile, NGOReservationHistoryRow };
