import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  CreateRatingRequest,
  CreateRatingResponse,
  DbId,
  ListingRating,
  ListingRatingsResponse,
  ProviderRatingSummary,
  ProviderRatingsResponse,
  RatingRow,
} from "@backend/contracts/api-contracts";

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

export async function createRating(
  payload: CreateRatingRequest
): Promise<RatingRow> {
  const { data } = await api.post<CreateRatingResponse | RatingRow>(
    "/ratings",
    payload
  );

  return getEnvelopeData<RatingRow>(data);
}

export async function getListingRatings(
  listingId: DbId
): Promise<ListingRating[]> {
  const { data } = await api.get<ListingRatingsResponse | ListingRating[]>(
    `/ratings/listing/${String(listingId)}`
  );

  return getEnvelopeData<ListingRating[]>(data);
}

export async function getProviderRatings(
  providerId: DbId
): Promise<ProviderRatingSummary> {
  const { data } = await api.get<ProviderRatingsResponse | ProviderRatingSummary>(
    `/ratings/provider/${String(providerId)}`
  );

  return getEnvelopeData<ProviderRatingSummary>(data);
}

export function toRatingNumber(value: unknown): number {
  const rating = Number(value ?? 0);
  return Number.isFinite(rating) ? rating : 0;
}

export const ratingService = {
  createRating,
  getListingRatings,
  getProviderRatings,
  toRatingNumber,
  getErrorMessage,
};
