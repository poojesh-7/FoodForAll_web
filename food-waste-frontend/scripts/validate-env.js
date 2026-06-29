const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || "local").toLowerCase();
const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1").trim();
const apiProxyTarget = (process.env.API_PROXY_TARGET || "").trim();
const googleClientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();

try {
  if (!["local", "development", "staging", "production"].includes(appEnv)) {
    throw new Error("NEXT_PUBLIC_APP_ENV must be local, development, staging, or production");
  }

  const usesRelativeApiUrl = apiUrl.startsWith("/");

  if (usesRelativeApiUrl) {
    if (!apiUrl.startsWith("/api/v1")) {
      throw new Error("Relative NEXT_PUBLIC_API_URL must start with /api/v1");
    }

    if (apiProxyTarget) {
      const parsedProxyTarget = new URL(apiProxyTarget);
      if (!["http:", "https:"].includes(parsedProxyTarget.protocol)) {
        throw new Error("API_PROXY_TARGET must use HTTP or HTTPS");
      }

      if (appEnv === "production" && parsedProxyTarget.protocol !== "https:") {
        throw new Error("API_PROXY_TARGET must use HTTPS in production");
      }
    }
  } else {
    const parsed = new URL(apiUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("NEXT_PUBLIC_API_URL must use HTTP or HTTPS");
    }

    if (appEnv === "production" && parsed.protocol !== "https:") {
      throw new Error("NEXT_PUBLIC_API_URL must use HTTPS in production");
    }
  }

  if (appEnv === "production" && !googleClientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is required in production");
  }

  process.stdout.write("Frontend environment validation passed\n");
} catch (err) {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
}
