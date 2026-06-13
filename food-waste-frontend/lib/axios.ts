import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { getPublicApiBaseUrl } from "./env";

const REFRESH_TOKEN_PATH = "/auth/refresh-token";
export const AUTH_SESSION_EXPIRED_EVENT = "auth:session-expired";
const PUBLIC_AUTH_PATHS = [
  "/auth/send-otp",
  "/auth/verify-otp",
  "/auth/google",
  REFRESH_TOKEN_PATH,
  "/auth/logout",
];

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

let refreshPromise: Promise<unknown> | null = null;
let refreshAuthRejected = false;

export function resetAuthRefreshFailure() {
  refreshAuthRejected = false;
}

const api = axios.create({
  baseURL: getPublicApiBaseUrl(),
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

function getPathname(url?: string) {
  if (!url) return "";

  try {
    return new URL(url, api.defaults.baseURL).pathname;
  } catch {
    return url;
  }
}

function shouldSkipRefresh(url?: string) {
  if (refreshAuthRejected) return true;

  const pathname = getPathname(url);
  return PUBLIC_AUTH_PATHS.some((path) => pathname.endsWith(path));
}

function getResponseStatus(error: unknown) {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    return typeof response?.status === "number" ? response.status : null;
  }

  return null;
}

function isPermanentRefreshFailure(error: unknown) {
  const status = getResponseStatus(error);
  return status === 401 || status === 403;
}

function notifySessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
}

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = api
      .post(REFRESH_TOKEN_PATH)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

api.interceptors.request.use((config) => {
  config.withCredentials = true;
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  config.headers.set("x-request-id", requestId);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      shouldSkipRefresh(originalRequest.url)
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      await refreshAccessToken();
      resetAuthRefreshFailure();
      return api(originalRequest);
    } catch (refreshError) {
      refreshAuthRejected = isPermanentRefreshFailure(refreshError);
      if (refreshAuthRejected) {
        notifySessionExpired();
      }
      return Promise.reject(refreshError);
    }
  }
);

export default api;
