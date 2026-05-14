import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

const DEFAULT_API_BASE_URL = "http://localhost:5000/api/v1";
const REFRESH_TOKEN_PATH = "/auth/refresh-token";
const PUBLIC_AUTH_PATHS = [
  "/auth/send-otp",
  "/auth/verify-otp",
  REFRESH_TOKEN_PATH,
  "/auth/complete-profile",
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

function getApiBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!configuredUrl) {
    return DEFAULT_API_BASE_URL;
  }

  const baseUrl = configuredUrl.replace(/\/+$/, "");
  return baseUrl.endsWith("/api/v1") ? baseUrl : `${baseUrl}/api/v1`;
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
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
