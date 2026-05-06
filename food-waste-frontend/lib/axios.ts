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
  const pathname = getPathname(url);
  return PUBLIC_AUTH_PATHS.some((path) => pathname.endsWith(path));
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
      await api.post(REFRESH_TOKEN_PATH);
      return api(originalRequest);
    } catch (refreshError) {
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.assign("/login");
      }

      return Promise.reject(refreshError);
    }
  }
);

export default api;
