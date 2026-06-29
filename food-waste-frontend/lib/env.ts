const DEFAULT_API_BASE_URL = "http://localhost:5000/api/v1";
const RELATIVE_API_BASE_URL = "/api/v1";

function normalizeApiUrl(value?: string) {
  const rawValue = value?.trim();
  if (!rawValue) {
    return process.env.NEXT_PUBLIC_APP_ENV === "production"
      ? RELATIVE_API_BASE_URL
      : DEFAULT_API_BASE_URL;
  }

  if (rawValue.startsWith("/")) {
    const basePath = rawValue.replace(/\/+$/, "");
    return basePath.endsWith("/api/v1") ? basePath : `${basePath}/api/v1`;
  }

  const baseUrl = rawValue.replace(/\/+$/, "");
  return baseUrl.endsWith("/api/v1") ? baseUrl : `${baseUrl}/api/v1`;
}

export function getPublicApiBaseUrl() {
  return normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);
}

export function getPublicSocketUrl() {
  return getPublicApiBaseUrl().replace(/\/api\/v1\/?$/, "");
}

export function getPublicGoogleClientId() {
  return (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();
}

export function validatePublicEnv() {
  const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || "local").toLowerCase();
  const apiUrl = getPublicApiBaseUrl();
  const googleClientId = getPublicGoogleClientId();

  if (!["local", "development", "staging", "production"].includes(appEnv)) {
    throw new Error("NEXT_PUBLIC_APP_ENV must be local, development, staging, or production");
  }

  if (apiUrl.startsWith("/")) {
    if (!apiUrl.startsWith("/api/v1")) {
      throw new Error("Relative NEXT_PUBLIC_API_URL must start with /api/v1");
    }
  } else {
    const parsed = new URL(apiUrl);
    if (appEnv === "production" && parsed.protocol !== "https:") {
      throw new Error("NEXT_PUBLIC_API_URL must use HTTPS in production");
    }
  }

  if (appEnv === "production" && !googleClientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is required in production");
  }

  return { appEnv, apiUrl, googleClientId };
}
