import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  DbId,
  GetUserResponse,
  UpdateUserRequest,
  UpdateUserResponse,
  UserHistoryItem,
  UserHistoryResponse,
  UserProfile,
  UserUpdateResult,
} from "@backend/contracts/api-contracts";

type ApiBody<TContract, TLegacy> = TContract | TLegacy;

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

export async function getUser(id: DbId): Promise<UserProfile> {
  const { data } = await api.get<ApiBody<GetUserResponse, UserProfile>>(
    `/users/${id}`
  );

  return getEnvelopeData<UserProfile>(data);
}

export async function updateUser(
  id: DbId,
  payload: UpdateUserRequest
): Promise<UserUpdateResult> {
  const { data } = await api.put<
    ApiBody<UpdateUserResponse, UserUpdateResult>
  >(`/users/${id}`, payload);

  return getEnvelopeData<UserUpdateResult>(data);
}

export async function getUserHistory(id: DbId): Promise<UserHistoryItem[]> {
  const { data } = await api.get<
    ApiBody<UserHistoryResponse, UserHistoryItem[]>
  >(`/users/${id}/history`);

  return getEnvelopeData<UserHistoryItem[]>(data);
}

export const userService = {
  getUser,
  updateUser,
  getUserHistory,
  getErrorMessage,
};
