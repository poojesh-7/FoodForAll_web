export interface SendOtpRequest {
  phone: string;
}

export interface ApiErrorResponse {
  error?: string;
  message?: string;
}

export interface SendOtpResponse {
  message: string;
}

export interface VerifyOtpRequest {
  phone: string;
  otp: string;
}

export interface AuthUser {
  id?: string;
  phone: string;
  role?: "restaurant" | "ngo";
  profileCompleted?: boolean;
}

export interface VerifyOtpResponse {
  message: string;
  isNewUser: boolean;
  user?: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
}

export interface LogoutResponse {
  message: string;
}
