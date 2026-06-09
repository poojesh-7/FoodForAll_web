const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWT_ALGORITHMS = Object.freeze(["HS256"]);
const JWT_ISSUER = process.env.JWT_ISSUER || "foodforall-api";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "foodforall-client";
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_BYTES = 64;
const REFRESH_TOKEN_HEX_LENGTH = REFRESH_TOKEN_BYTES * 2;

class TokenVerificationError extends Error {
  constructor(reason, message, cause) {
    super(message);
    this.name = "TokenVerificationError";
    this.reason = reason;
    this.cause = cause;
  }
}

class TokenSourceError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "TokenSourceError";
    this.reason = reason;
  }
}

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return secret;
}

function getJwtVerificationOptions() {
  return {
    algorithms: JWT_ALGORITHMS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
}

function assertCompactJwt(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new TokenVerificationError("malformed_token", "JWT is missing");
  }

  const compact = token.trim();
  if (compact.split(".").length !== 3) {
    throw new TokenVerificationError("malformed_token", "JWT must have three segments");
  }

  return compact;
}

function assertAllowedAlgorithm(token) {
  const decoded = jwt.decode(token, { complete: true });
  const algorithm = decoded?.header?.alg;

  if (!algorithm) {
    throw new TokenVerificationError("malformed_token", "JWT header is invalid");
  }

  if (!JWT_ALGORITHMS.includes(algorithm)) {
    throw new TokenVerificationError(
      "algorithm_mismatch",
      "JWT algorithm is not allowed"
    );
  }
}

function classifyJwtError(err) {
  if (err instanceof TokenVerificationError) return err.reason;
  if (err instanceof jwt.TokenExpiredError) return "expired_token";
  if (err instanceof jwt.NotBeforeError) return "token_not_active";

  if (err instanceof jwt.JsonWebTokenError) {
    const message = String(err.message || "").toLowerCase();

    if (message.includes("audience invalid")) return "wrong_audience";
    if (message.includes("issuer invalid")) return "wrong_issuer";
    if (message.includes("invalid algorithm")) return "algorithm_mismatch";
    if (message.includes("signature required")) return "missing_signature";
    if (message.includes("invalid signature")) return "invalid_signature";
    if (message.includes("jwt malformed") || message.includes("invalid token")) {
      return "malformed_token";
    }
  }

  return "invalid_token";
}

function verifyJwtToken(token) {
  const compact = assertCompactJwt(token);
  assertAllowedAlgorithm(compact);

  try {
    const decoded = jwt.verify(compact, getJwtSecret(), getJwtVerificationOptions());

    if (!Number.isFinite(decoded?.exp)) {
      throw new TokenVerificationError(
        "missing_expiration",
        "JWT expiration claim is required"
      );
    }

    return decoded;
  } catch (err) {
    throw new TokenVerificationError(
      classifyJwtError(err),
      "JWT verification failed",
      err
    );
  }
}

function signAccessToken(user) {
  const sessionVersion = Number(
    user.auth_session_version ?? user.sessionVersion ?? user.session_version ?? 0
  );

  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      sv: Number.isFinite(sessionVersion) && sessionVersion >= 0 ? sessionVersion : 0,
    },
    getJwtSecret(),
    {
      algorithm: JWT_ALGORITHMS[0],
      audience: JWT_AUDIENCE,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      issuer: JWT_ISSUER,
    }
  );
}

function verifyAccessToken(token) {
  return verifyJwtToken(token);
}

function generateRefreshToken() {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
}

function verifyRefreshToken(refreshToken) {
  const token = String(refreshToken || "").trim();

  if (!token) {
    throw new TokenVerificationError(
      "missing_refresh_token",
      "Refresh token is missing"
    );
  }

  if (
    token.length !== REFRESH_TOKEN_HEX_LENGTH ||
    !/^[a-f0-9]+$/i.test(token)
  ) {
    throw new TokenVerificationError(
      "malformed_refresh_token",
      "Refresh token format is invalid"
    );
  }

  return token;
}

function extractBearerToken(authorization) {
  if (!authorization) return null;

  const parts = String(authorization).trim().split(/\s+/);
  const [scheme, token] = parts;

  if (parts.length !== 2 || scheme !== "Bearer" || !token) {
    throw new TokenSourceError(
      "malformed_authorization_header",
      "Authorization header must use Bearer token format"
    );
  }

  return token;
}

function extractAccessTokenFromRequest(req) {
  const bearerToken = extractBearerToken(req.headers?.authorization);

  if (bearerToken) {
    return { token: bearerToken, source: "authorization_header" };
  }

  const cookieToken = req.cookies?.accessToken;
  if (cookieToken) {
    return { token: String(cookieToken), source: "cookie" };
  }

  return { token: null, source: null };
}

function extractAccessTokenFromSocketHandshake(handshake, cookies = {}) {
  const socketAuthToken = handshake?.auth?.token;
  if (socketAuthToken) {
    return { token: String(socketAuthToken), source: "socket_auth" };
  }

  if (cookies.accessToken) {
    return { token: String(cookies.accessToken), source: "cookie" };
  }

  return { token: null, source: null };
}

module.exports = {
  ACCESS_TOKEN_EXPIRES_IN,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_ALGORITHMS,
  TokenSourceError,
  TokenVerificationError,
  classifyJwtError,
  extractAccessTokenFromRequest,
  extractAccessTokenFromSocketHandshake,
  generateAccessToken: signAccessToken,
  generateRefreshToken,
  getJwtVerificationOptions,
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
};
