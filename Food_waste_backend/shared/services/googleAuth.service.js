const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const MAX_GOOGLE_TOKEN_LENGTH = 8192;

let cachedKeys = new Map();
let cachedUntil = 0;

function withStatus(message, statusCode, reason) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.reason = reason;
  return error;
}

function getAllowedClientIds() {
  return [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    ...(process.env.GOOGLE_ALLOWED_CLIENT_IDS || "").split(","),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function assertGoogleCredential(credential) {
  const token = String(credential || "").trim();

  if (!token || token.length > MAX_GOOGLE_TOKEN_LENGTH) {
    throw withStatus("Google credential is invalid", 400, "invalid_google_credential");
  }

  return token;
}

function getCacheMaxAge(cacheControl) {
  const match = String(cacheControl || "").match(/max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : 3600;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
}

function jwkToPem(jwk) {
  return crypto
    .createPublicKey({
      key: jwk,
      format: "jwk",
    })
    .export({
      format: "pem",
      type: "spki",
    });
}

async function fetchGoogleKeys() {
  if (cachedKeys.size && cachedUntil > Date.now()) {
    return cachedKeys;
  }

  const response = await fetch(GOOGLE_JWKS_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw withStatus("Google authentication is temporarily unavailable", 503, "google_jwks_unavailable");
  }

  const body = await response.json();
  const keys = new Map();

  for (const jwk of body.keys || []) {
    if (jwk.kid && jwk.kty === "RSA") {
      keys.set(jwk.kid, jwkToPem(jwk));
    }
  }

  if (!keys.size) {
    throw withStatus("Google authentication is temporarily unavailable", 503, "google_jwks_empty");
  }

  cachedKeys = keys;
  cachedUntil = Date.now() + getCacheMaxAge(response.headers.get("cache-control")) * 1000;
  return cachedKeys;
}

async function getGoogleSigningKey(token) {
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded?.header || decoded.header.alg !== "RS256" || !decoded.header.kid) {
    throw withStatus("Google credential is invalid", 401, "invalid_google_token_header");
  }

  let keys = await fetchGoogleKeys();
  let key = keys.get(decoded.header.kid);

  if (!key) {
    cachedUntil = 0;
    keys = await fetchGoogleKeys();
    key = keys.get(decoded.header.kid);
  }

  if (!key) {
    throw withStatus("Google credential is invalid", 401, "google_key_not_found");
  }

  return key;
}

async function verifyGoogleIdToken(credential) {
  const token = assertGoogleCredential(credential);
  const allowedClientIds = getAllowedClientIds();

  if (!allowedClientIds.length) {
    throw withStatus("Google authentication is not configured", 503, "google_auth_not_configured");
  }

  const signingKey = await getGoogleSigningKey(token);

  let payload;
  try {
    payload = jwt.verify(token, signingKey, {
      algorithms: ["RS256"],
      audience: allowedClientIds,
      issuer: GOOGLE_ISSUERS,
    });
  } catch (err) {
    throw withStatus("Google credential is invalid", 401, "invalid_google_token");
  }

  const googleId = String(payload.sub || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  if (!googleId || !email || !emailVerified) {
    throw withStatus("Google account must include a verified email", 401, "google_email_unverified");
  }

  return {
    googleId,
    email,
    emailVerified,
    name: payload.name ? String(payload.name) : null,
    picture: payload.picture ? String(payload.picture) : null,
  };
}

module.exports = {
  getAllowedClientIds,
  verifyGoogleIdToken,
};
