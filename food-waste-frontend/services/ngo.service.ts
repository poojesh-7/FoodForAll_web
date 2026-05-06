import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  NGORegistration,
  RegisterNGOData,
  RegisterNGORequest,
  RegisterNGOResponse,
} from "@backend/contracts/api-contracts";

type LegacyRegisterNGOResponse = {
  message?: string;
  ngo: NGORegistration;
};

function getNGOData(body: RegisterNGOResponse | LegacyRegisterNGOResponse): RegisterNGOData {
  if ("data" in body) return body.data;
  return { ngo: body.ngo };
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

export const ngoService = {
  registerNGO,
  getErrorMessage,
};
