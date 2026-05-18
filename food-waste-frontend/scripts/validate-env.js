const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || "local").toLowerCase();
const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1").trim();

try {
  if (!["local", "development", "staging", "production"].includes(appEnv)) {
    throw new Error("NEXT_PUBLIC_APP_ENV must be local, development, staging, or production");
  }

  const parsed = new URL(apiUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("NEXT_PUBLIC_API_URL must use HTTP or HTTPS");
  }

  if (appEnv === "production" && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_API_URL must use HTTPS in production");
  }

  process.stdout.write("Frontend environment validation passed\n");
} catch (err) {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
}
