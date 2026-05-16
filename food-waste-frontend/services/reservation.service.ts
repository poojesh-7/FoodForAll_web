import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  CancelReservationResponse,
  CreateReservationRequest,
  CreateReservationResponse,
  DbId,
  GetMyReservationsResponse,
  GetProviderReservationsResponse,
  GetReservationByIdResponse,
  MarkAsPickedUpRequest,
  MarkAsPickedUpResponse,
  ProviderReservationRow,
  ReportProviderRequest,
  ReportProviderResponse,
  ReservationPricingPreview,
  ReservationPricingPreviewResponse,
  ReservationDetails,
  ReservationHistoryRow,
  ReservationWithPaymentData,
} from "@backend/contracts/api-contracts";

type MessageResponse = { message?: string };

function encodeId(id: DbId) {
  return encodeURIComponent(String(id));
}

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

export async function createReservation(
  payload: CreateReservationRequest
): Promise<ReservationWithPaymentData> {
  const { data } = await api.post<
    CreateReservationResponse | ReservationWithPaymentData
  >("/reservations", payload);

  return getEnvelopeData<ReservationWithPaymentData>(data);
}

export async function previewReservation(payload: {
  listing_id: DbId;
  quantity: number | string;
}): Promise<ReservationPricingPreview> {
  const { data } = await api.post<
    ReservationPricingPreviewResponse | ReservationPricingPreview
  >("/reservations/preview", payload);

  return getEnvelopeData<ReservationPricingPreview>(data);
}

export async function getReservationById(
  id: DbId
): Promise<ReservationDetails> {
  const { data } = await api.get<GetReservationByIdResponse | ReservationDetails>(
    `/reservations/${encodeId(id)}`
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
    `/reservations/${encodeId(id)}/cancel`
  );
}

export async function confirmPickup(
  id: DbId,
  payload: MarkAsPickedUpRequest
): Promise<void> {
  await api.put<MarkAsPickedUpResponse | MessageResponse>(
    `/reservations/${encodeId(id)}/pickup`,
    payload
  );
}

export async function reportProvider(
  id: DbId,
  payload: ReportProviderRequest
): Promise<void> {
  await api.post<ReportProviderResponse | MessageResponse>(
    `/reservations/${encodeId(id)}/report-provider`,
    payload
  );
}

export const reservationService = {
  createReservation,
  previewReservation,
  getMyReservations,
  getReservationById,
  getProviderReservations,
  cancelReservation,
  confirmPickup,
  reportProvider,
  getErrorMessage,
};
