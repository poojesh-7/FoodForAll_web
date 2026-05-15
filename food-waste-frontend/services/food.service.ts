import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  CreateFoodRequest,
  CreateFoodResponse,
  DeleteFoodResponse,
  FoodListingData,
  FoodListingRow,
  FoodNGOOption,
  GetActiveFoodResponse,
  GetAllFoodResponse,
  GetFoodByIdResponse,
  GetNearbyFoodResponse,
  GetMyRestaurantResponse,
  RegisterRestaurantData,
  RegisterRestaurantRequest,
  RegisterRestaurantResponse,
  RestaurantProfile,
  RestaurantRegistration,
  RequestNGORequest,
  RequestNGOResponse,
  UpdateFoodRequest,
  UpdateFoodResponse,
  ViewNGOsForFoodResponse,
} from "@backend/contracts/api-contracts";

type LegacyRegisterRestaurantResponse = {
  message?: string;
  restaurant: RestaurantRegistration;
};
type LegacyCreateFoodResponse = {
  message?: string;
  listing: FoodListingRow;
};
type MessageResponse = { message?: string; listing?: FoodListingRow };

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

function getRestaurantData(
  body: RegisterRestaurantResponse | LegacyRegisterRestaurantResponse
): RegisterRestaurantData {
  if ("data" in body) return body.data;
  return { restaurant: body.restaurant };
}

export async function registerRestaurant(
  payload: RegisterRestaurantRequest
): Promise<RegisterRestaurantData> {
  const formData = new FormData();

  formData.append("restaurant_name", payload.restaurant_name);
  formData.append("fssai_number", payload.fssai_number);
  formData.append("service_radius_km", String(payload.service_radius_km ?? ""));
  formData.append("latitude", String(payload.latitude));
  formData.append("longitude", String(payload.longitude));
  formData.append("fssai_certificate", payload.fssai_certificate);

  const { data } = await api.post<
    RegisterRestaurantResponse | LegacyRegisterRestaurantResponse
  >("/food/register", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return getRestaurantData(data);
}

export async function getMyRestaurant(): Promise<RestaurantProfile> {
  const { data } = await api.get<GetMyRestaurantResponse | RestaurantProfile>(
    "/food/me"
  );

  return getEnvelopeData<RestaurantProfile>(data);
}

export async function createFood(
  payload: CreateFoodRequest
): Promise<FoodListingRow> {
  const { data } = await api.post<CreateFoodResponse | LegacyCreateFoodResponse>(
    "/food",
    payload
  );
  return getEnvelopeData<FoodListingData>(data).listing;
}

export async function updateFood(
  id: string | number,
  payload: UpdateFoodRequest
): Promise<FoodListingRow> {
  const { data } = await api.put<UpdateFoodResponse | FoodListingRow>(
    `/food/${id}`,
    payload
  );
  return getEnvelopeData<FoodListingRow>(data);
}

export async function deleteFood(id: string | number): Promise<FoodListingRow | null> {
  const { data } = await api.delete<DeleteFoodResponse | MessageResponse>(
    `/food/${id}`
  );
  const body = getEnvelopeData<DeleteFoodResponse["data"] | MessageResponse>(data);
  return "listing" in body ? body.listing ?? null : null;
}

export async function getAllFood(): Promise<FoodListingRow[]> {
  const { data } = await api.get<GetAllFoodResponse | FoodListingRow[]>("/food");
  return getEnvelopeData<FoodListingRow[]>(data);
}

export async function getActiveFood(params?: {
  lat?: string | number;
  lng?: string | number;
  radius?: string | number;
}): Promise<FoodListingRow[]> {
  const { data } = await api.get<GetActiveFoodResponse | FoodListingRow[]>(
    "/food/active",
    { params }
  );
  return getEnvelopeData<FoodListingRow[]>(data);
}

export async function getNearbyFood(params: {
  lat: string | number;
  lng: string | number;
  radius?: string | number;
}) {
  const { data } = await api.get<GetNearbyFoodResponse | FoodListingRow[]>(
    "/food/nearby",
    { params }
  );
  return getEnvelopeData<GetNearbyFoodResponse["data"] | FoodListingRow[]>(data);
}

export async function getFoodById(id: string | number): Promise<FoodListingRow> {
  const { data } = await api.get<GetFoodByIdResponse | FoodListingRow>(
    `/food/${id}`
  );
  return getEnvelopeData<FoodListingRow>(data);
}

export async function viewNGOs(): Promise<FoodNGOOption[]> {
  const { data } = await api.get<ViewNGOsForFoodResponse | FoodNGOOption[]>(
    "/food/ngos"
  );
  return getEnvelopeData<FoodNGOOption[]>(data);
}

export async function requestNGO(
  listingId: string | number,
  payload: RequestNGORequest
): Promise<void> {
  await api.post<RequestNGOResponse | MessageResponse>(
    `/food/${listingId}/request-ngo`,
    payload
  );
}

export const foodService = {
  registerRestaurant,
  getMyRestaurant,
  createFood,
  updateFood,
  deleteFood,
  getAllFood,
  getActiveFood,
  getNearbyFood,
  getFoodById,
  viewNGOs,
  requestNGO,
  getErrorMessage,
};
