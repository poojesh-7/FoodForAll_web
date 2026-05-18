const DEFAULT_API_BASE_URL = "http://localhost:5000/api/v1";

function normalizeApiUrl(value?: string) {
  if (!value?.trim()) return DEFAULT_API_BASE_URL;

  const baseUrl = value.trim().replace(/\/+$/, "");
  return baseUrl.endsWith("/api/v1") ? baseUrl : `${baseUrl}/api/v1`;
}

export function getPublicApiBaseUrl() {
  return normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);
}

export function getPublicSocketUrl() {
  return getPublicApiBaseUrl().replace(/\/api\/v1\/?$/, "");
}

export function validatePublicEnv() {
  const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || "local").toLowerCase();
  const apiUrl = getPublicApiBaseUrl();

  if (!["local", "development", "staging", "production"].includes(appEnv)) {
    throw new Error("NEXT_PUBLIC_APP_ENV must be local, development, staging, or production");
  }

  const parsed = new URL(apiUrl);
  if (appEnv === "production" && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_API_URL must use HTTPS in production");
  }

  return { appEnv, apiUrl };
}
