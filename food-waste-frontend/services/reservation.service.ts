import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  CancelReservationResponse,
  DbId,
  GetMyReservationsResponse,
  GetProviderReservationsResponse,
  GetReservationByIdResponse,
  MarkAsPickedUpRequest,
  MarkAsPickedUpResponse,
  ProviderReservationRow,
  ReservationDetails,
  ReservationHistoryRow,
} from "@backend/contracts/api-contracts";

type MessageResponse = { message?: string };

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

function getArrayData<TItem>(body: { data: TItem[] } | TItem[] | unknown): TItem[] {
  const data = getEnvelopeData<TItem[] | unknown>(body);
  return Array.isArray(data)
    ? data.filter((item): item is TItem => Boolean(item) && typeof item === "object")
    : [];
}

export async function getMyReservations(): Promise<ReservationHistoryRow[]> {
  const { data } = await api.get<
    GetMyReservationsResponse | ReservationHistoryRow[]
  >("/reservations/my");

  return getArrayData<ReservationHistoryRow>(data);
}

export async function getReservationById(
  id: DbId
): Promise<ReservationDetails> {
  const { data } = await api.get<GetReservationByIdResponse | ReservationDetails>(
    `/reservations/${String(id)}`
  );

  return getEnvelopeData<ReservationDetails>(data);
}

export async function getProviderReservations(): Promise<ProviderReservationRow[]> {
  const { data } = await api.get<
    GetProviderReservationsResponse | ProviderReservationRow[]
  >("/reservations/provider");

  return getArrayData<ProviderReservationRow>(data);
}

export async function cancelReservation(id: DbId): Promise<void> {
  await api.put<CancelReservationResponse | MessageResponse>(
    `/reservations/${String(id)}/cancel`
  );
}

export async function confirmPickup(
  id: DbId,
  payload: MarkAsPickedUpRequest
): Promise<void> {
  await api.put<MarkAsPickedUpResponse | MessageResponse>(
    `/reservations/${String(id)}/pickup`,
    payload
  );
}

export const reservationService = {
  getMyReservations,
  getReservationById,
  getProviderReservations,
  cancelReservation,
  confirmPickup,
  getErrorMessage,
};
