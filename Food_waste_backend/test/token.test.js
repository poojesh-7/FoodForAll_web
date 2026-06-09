const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret-with-enough-length-for-jwt-tests";

const {
  JWT_AUDIENCE,
  JWT_ISSUER,
  TokenSourceError,
  TokenVerificationError,
  extractAccessTokenFromRequest,
  generateRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require("../utils/token");

function expectTokenFailure(fn, reason) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof TokenVerificationError);
    assert.equal(err.reason, reason);
    return true;
  });
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signWithClaims(options = {}) {
  return jwt.sign(
    { id: randomUUID(), role: "user" },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      audience: JWT_AUDIENCE,
      expiresIn: "15m",
      issuer: JWT_ISSUER,
      ...options,
    }
  );
}

test("signAccessToken creates a verifiable HS256 token with required claims", () => {
  const user = { id: randomUUID(), role: "admin", auth_session_version: 2 };
  const token = signAccessToken(user);
  const decoded = verifyAccessToken(token);

  assert.equal(decoded.id, user.id);
  assert.equal(decoded.role, user.role);
  assert.equal(decoded.sv, user.auth_session_version);
  assert.equal(decoded.iss, JWT_ISSUER);
  assert.equal(decoded.aud, JWT_AUDIENCE);
  assert.equal(decoded.exp > Math.floor(Date.now() / 1000), true);
});

test("verifyAccessToken rejects expired tokens", () => {
  const token = signWithClaims({ expiresIn: -1 });

  expectTokenFailure(() => verifyAccessToken(token), "expired_token");
});

test("verifyAccessToken rejects tokens without expiration", () => {
  const token = jwt.sign(
    { id: randomUUID(), role: "user" },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      noTimestamp: true,
    }
  );

  expectTokenFailure(() => verifyAccessToken(token), "missing_expiration");
});

test("verifyAccessToken rejects malformed tokens", () => {
  expectTokenFailure(() => verifyAccessToken("not-a-jwt"), "malformed_token");
});

test("verifyAccessToken rejects alg none tokens before verification", () => {
  const token = [
    encodeJson({ alg: "none", typ: "JWT" }),
    encodeJson({ id: randomUUID(), role: "user", iss: JWT_ISSUER, aud: JWT_AUDIENCE }),
    "",
  ].join(".");

  expectTokenFailure(() => verifyAccessToken(token), "algorithm_mismatch");
});

test("verifyAccessToken rejects wrong audience", () => {
  const token = signWithClaims({ audience: "unexpected-client" });

  expectTokenFailure(() => verifyAccessToken(token), "wrong_audience");
});

test("verifyAccessToken rejects wrong issuer", () => {
  const token = signWithClaims({ issuer: "unexpected-issuer" });

  expectTokenFailure(() => verifyAccessToken(token), "wrong_issuer");
});

test("verifyAccessToken rejects tampered payloads", () => {
  const token = signWithClaims();
  const parts = token.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  payload.role = "admin";
  const tamperedToken = [parts[0], encodeJson(payload), parts[2]].join(".");

  expectTokenFailure(() => verifyAccessToken(tamperedToken), "invalid_signature");
});

test("verifyRefreshToken accepts generated opaque refresh tokens", () => {
  const refreshToken = generateRefreshToken();

  assert.equal(verifyRefreshToken(refreshToken), refreshToken);
});

test("verifyRefreshToken rejects malformed refresh tokens", () => {
  expectTokenFailure(() => verifyRefreshToken("not-a-refresh-token"), "malformed_refresh_token");
});

test("extractAccessTokenFromRequest prefers Authorization Bearer over cookies", () => {
  const result = extractAccessTokenFromRequest({
    headers: { authorization: "Bearer header-token" },
    cookies: { accessToken: "cookie-token" },
  });

  assert.deepEqual(result, {
    token: "header-token",
    source: "authorization_header",
  });
});

test("extractAccessTokenFromRequest rejects malformed Authorization headers", () => {
  assert.throws(
    () =>
      extractAccessTokenFromRequest({
        headers: { authorization: "Basic abc" },
        cookies: { accessToken: "cookie-token" },
      }),
    (err) => {
      assert.ok(err instanceof TokenSourceError);
      assert.equal(err.reason, "malformed_authorization_header");
      return true;
    }
  );
});
