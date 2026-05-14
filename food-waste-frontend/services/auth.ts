import { AxiosError } from "axios";
import api from "@/lib/axios";
import type {
  ApiErrorResponse,
  AuthMeUser,
  AuthUser,
  CompleteProfileRequest,
  CompleteProfileResponse,
  GetMeResponse,
  LogoutResponse,
  RefreshTokenResponse,
  SendOTPRequest,
  SendOTPResponse,
  SetRoleRequest,
  SetRoleResponse,
  UpdateLocationRequest,
  UpdateLocationResponse,
  VerifyOTPRequest,
  VerifyOTPResponse,
} from "@backend/contracts/api-contracts";

type ApiBody<TContract, TLegacy> = TContract | TLegacy;
type BackendErrorResponse = ApiErrorResponse | { error?: string; message?: string };

export type SendOtpPayload = SendOTPRequest;
export type SendOtpResult = SendOTPResponse;

export type VerifyOtpPayload = VerifyOTPRequest;
export type VerifyOtpResult = VerifyOTPResponse["data"] & {
  message?: string;
};

export type SetRolePayload = SetRoleRequest;
export type SetRoleResult = SetRoleResponse["data"];

export type CompleteProfilePayload = CompleteProfileRequest;
export type CompleteProfileResult = CompleteProfileResponse["data"];

export type UpdateLocationPayload = UpdateLocationRequest;
export type UpdateLocationResult = UpdateLocationResponse["data"];

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

function getResponseMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "message" in body) {
    return String((body as { message?: unknown }).message ?? "");
  }

  return undefined;
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (error instanceof Error && !("isAxiosError" in error)) {
    return error.message;
  }

  const axiosError = error as AxiosError<BackendErrorResponse | string | unknown>;

  const responseData = axiosError.response?.data;

  if (typeof responseData === "string") {
    const trimmed = responseData.trim();

    if (!trimmed) return axiosError.message || "Something went wrong. Please try again.";

    if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
      return axiosError.response?.status
        ? `Server error (${axiosError.response.status}). Please try again.`
        : "Server returned an unexpected HTML response.";
    }

    return trimmed;
  }

  if (responseData && typeof responseData === "object") {
    if ("message" in responseData && responseData.message) {
      return String(responseData.message);
    }

    if ("error" in responseData && responseData.error) {
      return String(responseData.error);
    }

    if ("details" in responseData && responseData.details) {
      return String(responseData.details);
    }
  }

  return axiosError.message || "Something went wrong. Please try again.";
}

export async function sendOtp(payload: SendOtpPayload): Promise<SendOtpResult> {
  const { data } = await api.post<SendOTPResponse>("/auth/send-otp", payload);
  return data;
}

export async function verifyOtp(
  payload: VerifyOtpPayload
): Promise<VerifyOtpResult> {
  type LegacyVerifyOtpResponse = VerifyOTPResponse["data"] & {
    message?: string;
    success?: boolean;
  };

  const { data } = await api.post<
    ApiBody<VerifyOTPResponse, LegacyVerifyOtpResponse>
  >("/auth/verify-otp", payload);

  return {
    ...getEnvelopeData<VerifyOTPResponse["data"]>(data),
    message: getResponseMessage(data),
  };
}

export async function setRole(payload: SetRolePayload): Promise<SetRoleResult> {
  type LegacySetRoleResponse = SetRoleResponse["data"] & {
    message?: string;
    success?: boolean;
  };

  const { data } = await api.post<ApiBody<SetRoleResponse, LegacySetRoleResponse>>(
    "/auth/set-role",
    payload
  );

  return getEnvelopeData<SetRoleResponse["data"]>(data);
}

export async function refreshToken(): Promise<RefreshTokenResponse> {
  const { data } = await api.post<RefreshTokenResponse>("/auth/refresh-token");
  return data;
}

export async function completeProfile(
  payload: CompleteProfilePayload
): Promise<CompleteProfileResult> {
  type LegacyCompleteProfileResponse = CompleteProfileResponse["data"] & {
    message?: string;
    success?: boolean;
  };

  const { data } = await api.post<
    ApiBody<CompleteProfileResponse, LegacyCompleteProfileResponse>
  >("/auth/complete-profile", payload);

  return getEnvelopeData<CompleteProfileResponse["data"]>(data);
}

export async function updateLocation(
  payload: UpdateLocationPayload
): Promise<UpdateLocationResult> {
  type LegacyUpdateLocationResponse = UpdateLocationResponse["data"] & {
    message?: string;
    success?: boolean;
  };

  const { data } = await api.put<
    ApiBody<UpdateLocationResponse, LegacyUpdateLocationResponse>
  >("/auth/update-location", payload);

  return getEnvelopeData<UpdateLocationResponse["data"]>(data);
}

export async function fetchMe(): Promise<AuthMeUser> {
  type LegacyMeResponse = GetMeResponse["data"];

  const { data } = await api.get<ApiBody<GetMeResponse, LegacyMeResponse>>(
    "/auth/me"
  );

  return getEnvelopeData<GetMeResponse["data"]>(data).user;
}

export async function logout(): Promise<LogoutResponse> {
  const { data } = await api.post<LogoutResponse>("/auth/logout");
  return data;
}

export const authService = {
  sendOtp,
  verifyOtp,
  setRole,
  refreshToken,
  completeProfile,
  updateLocation,
  fetchMe,
  me: fetchMe,
  logout,
  getErrorMessage,
};

export type { AuthMeUser, AuthUser };
