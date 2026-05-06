import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  CompleteTaskRequest,
  CompleteTaskResponse,
  DbId,
  JoinNGORequest,
  JoinNGOResponse,
  LeaveNGORequest,
  LeaveNGOResponse,
  ReservationRow,
  RespondToVolunteerRequestBody,
  RespondToVolunteerRequestResponse,
  StartTaskResponse,
  VolunteerAvailableNGO,
  VolunteerAvailableResponse,
  VolunteerCurrentTask,
  VolunteerDashboardData,
  VolunteerDashboardResponse,
  VolunteerMembershipRow,
  VolunteerRequestRow,
  VolunteerRequestsResponse,
  VolunteerTask,
  VolunteerTasksResponse,
} from "@backend/contracts/api-contracts";

type MessageResponse = { message?: string };
type LegacyDashboardResponse = VolunteerDashboardData;
type LegacyStartTaskResponse = {
  message?: string;
  reservation: ReservationRow;
};

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

export async function getDashboard(): Promise<VolunteerDashboardData> {
  const { data } = await api.get<VolunteerDashboardResponse | LegacyDashboardResponse>(
    "/volunteers/dashboard"
  );

  return getEnvelopeData<VolunteerDashboardData>(data);
}

export async function getAvailableNGOs(): Promise<VolunteerAvailableNGO[]> {
  const { data } = await api.get<VolunteerAvailableResponse | VolunteerAvailableNGO[]>(
    "/volunteers/available"
  );

  return getEnvelopeData<VolunteerAvailableNGO[]>(data);
}

export async function joinNGO(payload: JoinNGORequest): Promise<VolunteerMembershipRow> {
  const { data } = await api.post<JoinNGOResponse | VolunteerMembershipRow>(
    "/volunteers/join",
    payload
  );

  return getEnvelopeData<VolunteerMembershipRow>(data);
}

export async function leaveNGO(payload: LeaveNGORequest): Promise<void> {
  await api.put<LeaveNGOResponse | MessageResponse>("/volunteers/leave", payload);
}

export async function getRequests(): Promise<VolunteerRequestRow[]> {
  const { data } = await api.get<VolunteerRequestsResponse | VolunteerRequestRow[]>(
    "/volunteers/requests"
  );

  return getEnvelopeData<VolunteerRequestRow[]>(data);
}

export async function respondToRequest(
  requestId: DbId,
  payload: RespondToVolunteerRequestBody
): Promise<void> {
  await api.put<RespondToVolunteerRequestResponse | MessageResponse>(
    `/volunteers/requests/${String(requestId)}/respond`,
    payload
  );
}

export async function getTasks(params: {
  lat: string | number;
  lng: string | number;
  radius?: string | number;
}): Promise<VolunteerTask[]> {
  const { data } = await api.get<VolunteerTasksResponse | VolunteerTask[]>(
    "/volunteers/tasks",
    { params }
  );

  return getEnvelopeData<VolunteerTask[]>(data);
}

export async function startTask(taskId: DbId): Promise<ReservationRow> {
  const { data } = await api.put<StartTaskResponse | LegacyStartTaskResponse>(
    `/volunteers/tasks/${String(taskId)}/start`
  );

  return getEnvelopeData<LegacyStartTaskResponse>(data).reservation;
}

export async function completeTask(
  taskId: DbId,
  payload: CompleteTaskRequest
): Promise<void> {
  await api.put<CompleteTaskResponse | MessageResponse>(
    `/volunteers/tasks/${String(taskId)}/complete`,
    payload
  );
}

export const volunteerService = {
  getDashboard,
  getAvailableNGOs,
  joinNGO,
  leaveNGO,
  getRequests,
  respondToRequest,
  getTasks,
  startTask,
  completeTask,
  getErrorMessage,
};

export type { VolunteerCurrentTask };
