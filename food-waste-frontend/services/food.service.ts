import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  RegisterRestaurantData,
  RegisterRestaurantRequest,
  RegisterRestaurantResponse,
  RestaurantRegistration,
} from "@backend/contracts/api-contracts";

type LegacyRegisterRestaurantResponse = {
  message?: string;
  restaurant: RestaurantRegistration;
};

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

export const foodService = {
  registerRestaurant,
  getErrorMessage,
};
