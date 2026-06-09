import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { getPublicApiBaseUrl } from "./env";

const REFRESH_TOKEN_PATH = "/auth/refresh-token";
const PUBLIC_AUTH_PATHS = [
  "/auth/send-otp",
  "/auth/verify-otp",
  REFRESH_TOKEN_PATH,
  "/auth/logout",
];

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

let refreshPromise: Promise<unknown> | null = null;
let refreshTokenFailed = false;

export function resetAuthRefreshFailure() {
  refreshTokenFailed = false;
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
  if (refreshTokenFailed) return true;

  const pathname = getPathname(url);
  return PUBLIC_AUTH_PATHS.some((path) => pathname.endsWith(path));
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
      refreshTokenFailed = true;
      return Promise.reject(refreshError);
    }
  }
);

export default api;
