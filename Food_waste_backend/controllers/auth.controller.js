const pool = require("../shared/config/db");
const redis = require("../shared/config/redis");
const crypto = require("crypto");
const {
  generateAccessToken,
  generateRefreshToken,
  TokenVerificationError,
  verifyRefreshToken,
} = require("../utils/token");
const logger = require("../shared/utils/logger");
const {
  ensureEmailAvailable,
  ensurePhoneAvailable,
  findUserByEmail,
  getIdentityConflictMessage,
  isIdentityUniqueViolation,
} = require("../utils/identity");
const { getPhoneLookupValues, normalizePhoneNumber } = require("../utils/phone");
const {
  checkVerification,
  getSafeTwilioError,
  sendVerification,
} = require("../shared/services/twilioVerify.service");
const {
  assertCanSendOtp,
  assertCanVerifyOtp,
  getFingerprint,
  recordOtpSend,
  recordOtpVerifyFailure,
  recordOtpVerifySuccess,
} = require("../shared/services/otpAbuse.service");
const { getClientIp } = require("../middlewares/rateLimit.middleware");
const {
  isProvided,
  isValidEmail,
  isValidLatitude,
  isValidLongitude,
  normalizeEmail,
  toNumber,
} = require("../utils/validation");
const {
  normalizeAddress,
  normalizePersonName,
  normalizeRequiredAddress,
  normalizeRequiredPhone,
} = require("../utils/fieldValidation");
const { validateOnboardingRoleSelection } = require("../utils/roles");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../shared/config/runtimeSchema");
const {
  assertProfilePhoneMatchesAuthenticatedUser,
} = require("../shared/services/authProfile.service");
const {
  verifyGoogleIdToken,
} = require("../shared/services/googleAuth.service");

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_REUSE_GRACE_SECONDS = 10;
let authSchemaReady = null;

function hashRefreshToken(refreshToken) {
  return crypto
    .createHash("sha256")
    .update(String(refreshToken || ""))
    .digest("hex");
}

function getSessionFingerprint(req) {
  return crypto
    .createHash("sha256")
    .update(`${getFingerprint(req)}:${getClientIp(req)}`)
    .digest("hex");
}

async function ensureAuthHardeningSchema() {
  if (shouldSkipRuntimeSchemaMutation()) {
    authSchemaReady = authSchemaReady || Promise.resolve();
    return authSchemaReady;
  }

  if (!authSchemaReady) {
    authSchemaReady = pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS refresh_token_family TEXT NULL,
      ADD COLUMN IF NOT EXISTS refresh_token_device TEXT NULL,
      ADD COLUMN IF NOT EXISTS refresh_token_last_used_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS last_auth_activity_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS auth_session_version INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS google_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'otp',
      ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS profile_image_url TEXT NULL,
      ADD COLUMN IF NOT EXISTS profile_image_public_id TEXT NULL,
      ALTER COLUMN phone DROP NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique_idx
        ON users (google_id)
        WHERE google_id IS NOT NULL AND trim(google_id) <> '';
    `);
  }

  return authSchemaReady;
}

function isProduction() {
  return process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
}

function getSameSiteMode() {
  const configured = String(process.env.COOKIE_SAME_SITE || "").toLowerCase();
  if (["lax", "strict", "none"].includes(configured)) return configured;
  return isProduction() ? "none" : "lax";
}

function getCookieOptions(maxAge) {
  const sameSite = getSameSiteMode();
  const secure = isProduction() || process.env.COOKIE_SECURE === "true" || sameSite === "none";

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge,
  };
}

function getClearCookieOptions() {
  const { maxAge, ...options } = getCookieOptions(0);
  return options;
}

function setAccessCookie(res, accessToken) {
  res.cookie(
    "accessToken",
    accessToken,
    getCookieOptions(ACCESS_TOKEN_MAX_AGE_MS)
  );
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(
    "refreshToken",
    refreshToken,
    getCookieOptions(REFRESH_TOKEN_MAX_AGE_MS)
  );
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);
}

function clearAuthCookies(res) {
  res.clearCookie("accessToken", getClearCookieOptions());
  res.clearCookie("refreshToken", getClearCookieOptions());
}

function rejectRefreshToken(res, message) {
  clearAuthCookies(res);
  return res.status(401).json({
    error: message,
  });
}

function getRefreshReuseKey(refreshToken) {
  return `auth:refresh-reuse:${crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex")}`;
}

async function rememberRotatedRefreshToken(oldRefreshToken, session) {
  await redis.setEx(
    getRefreshReuseKey(oldRefreshToken),
    REFRESH_REUSE_GRACE_SECONDS,
    JSON.stringify(session)
  );
}

async function getRecentlyRotatedRefreshToken(oldRefreshToken) {
  const raw = await redis.get(getRefreshReuseKey(oldRefreshToken));
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    return session?.accessToken && session?.refreshToken ? session : null;
  } catch {
    return null;
  }
}

async function getRecentlyRotatedRefreshTokenWithRetry(oldRefreshToken) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await getRecentlyRotatedRefreshToken(oldRefreshToken);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return null;
}

function getRefreshExpiry() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
}

function jsonError(res, status, message, extra = {}) {
  if (extra.retryAfter) {
    res.set("Retry-After", String(extra.retryAfter));
  }

  return res.status(status).json({
    success: false,
    message,
    error: message,
    code: extra.code,
    retryAfter: extra.retryAfter,
    data: null,
  });
}

function isValidOtpCode(value) {
  return /^\d{4,10}$/.test(String(value || "").trim());
}

async function findUserByPhone(normalizedPhone) {
  const lookupValues = getPhoneLookupValues(normalizedPhone);

  const result = await pool.query(
    `
    SELECT id, role, phone, auth_session_version
    FROM users
    WHERE phone = ANY($1::text[])
    ORDER BY CASE WHEN phone=$2 THEN 0 ELSE 1 END
    LIMIT 1
    `,
    [lookupValues, normalizedPhone]
  );

  if (!result.rows.length) return null;

  const user = result.rows[0];

  if (user.phone !== normalizedPhone) {
    try {
      const updateResult = await pool.query(
        `
        UPDATE users
        SET phone=$1
        WHERE id=$2
          AND NOT EXISTS (
            SELECT 1 FROM users WHERE phone=$1 AND id<>$2
          )
        RETURNING id, role, phone, auth_session_version
        `,
        [normalizedPhone, user.id]
      );

      return updateResult.rows[0] || user;
    } catch (err) {
      logger.warn("Unable to normalize existing user phone", {
        err,
        userId: user.id,
      });
    }
  }

  return user;
}

async function findOrCreateUserByPhone(normalizedPhone) {
  const existingUser = await findUserByPhone(normalizedPhone);

  if (existingUser) {
    return {
      isNewUser: false,
      user: {
        id: existingUser.id,
        role: existingUser.role,
        auth_session_version: existingUser.auth_session_version,
      },
    };
  }

  const newUser = await pool.query(
    `
    INSERT INTO users (phone, role, auth_provider, email_verified)
    VALUES ($1, $2, 'otp', false)
    ON CONFLICT (phone)
    DO UPDATE SET phone=EXCLUDED.phone
    RETURNING id, role, auth_session_version
    `,
    [normalizedPhone, null]
  );

  return {
    isNewUser: true,
    user: newUser.rows[0],
  };
}

async function createAuthenticatedSession(req, res, user) {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshTokenFamily = crypto.randomUUID();
  const expiry = getRefreshExpiry();

  await pool.query(
    `
    UPDATE users
    SET refresh_token=$1,
        refresh_token_expiry=$2,
        refresh_token_family=$3,
        refresh_token_device=$4,
        refresh_token_last_used_at=NOW(),
        last_auth_activity_at=NOW()
    WHERE id=$5
    `,
    [
      refreshTokenHash,
      expiry,
      refreshTokenFamily,
      getSessionFingerprint(req),
      user.id,
    ]
  );

  setAuthCookies(res, { accessToken, refreshToken });

  return {
    accessToken,
    refreshToken,
  };
}

function isGoogleIdentityConflict(row, googleId) {
  return Boolean(row?.google_id && row.google_id !== googleId);
}

async function findOrCreateUserByGoogleIdentity(googleProfile) {
  const { googleId, email, emailVerified, name, picture } = googleProfile;

  const byGoogle = await pool.query(
    `
    SELECT id, role, google_id, email, auth_session_version
    FROM users
    WHERE google_id=$1
    LIMIT 1
    `,
    [googleId]
  );

  if (byGoogle.rows.length) {
    const user = byGoogle.rows[0];
    const normalizedEmail = normalizeEmail(email);

    await ensureEmailAvailable(pool, normalizedEmail, user.id);

    const updated = await pool.query(
      `
      UPDATE users
      SET email=$1,
          email_verified=$2,
          auth_provider='google',
          profile_image_url=COALESCE(profile_image_url, $3),
          profile_image=COALESCE(profile_image, $3)
      WHERE id=$4
      RETURNING id, role, auth_session_version
      `,
      [normalizedEmail, emailVerified, picture, user.id]
    );

    return {
      isNewUser: false,
      linkedExistingUser: false,
      user: updated.rows[0],
    };
  }

  const existingByEmail = await findUserByEmail(pool, email);

  if (existingByEmail) {
    const current = await pool.query(
      `
      SELECT id, role, google_id, auth_session_version
      FROM users
      WHERE id=$1
      LIMIT 1
      `,
      [existingByEmail.id]
    );
    const row = current.rows[0];

    if (isGoogleIdentityConflict(row, googleId)) {
      const error = new Error("Email is already linked to another Google account");
      error.statusCode = 409;
      error.reason = "google_identity_conflict";
      throw error;
    }

    const updated = await pool.query(
      `
      UPDATE users
      SET google_id=$1,
          email=$2,
          email_verified=$3,
          auth_provider='google',
          profile_image_url=COALESCE(profile_image_url, $4),
          profile_image=COALESCE(profile_image, $4)
      WHERE id=$5
      RETURNING id, role, auth_session_version
      `,
      [googleId, normalizeEmail(email), emailVerified, picture, row.id]
    );

    return {
      isNewUser: false,
      linkedExistingUser: true,
      user: updated.rows[0],
    };
  }

  const created = await pool.query(
    `
    INSERT INTO users (
      google_id,
      email,
      email_verified,
      auth_provider,
      name,
      profile_image,
      profile_image_url,
      role
    )
    VALUES ($1,$2,$3,'google',$4,$5,$5,NULL)
    RETURNING id, role, auth_session_version
    `,
    [
      googleId,
      normalizeEmail(email),
      emailVerified,
      name ? String(name).trim().slice(0, 100) : null,
      picture || null,
    ]
  );

  return {
    isNewUser: true,
    linkedExistingUser: false,
    user: created.rows[0],
  };
}

// SEND OTP
exports.sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhoneNumber(phone);
    const ip = getClientIp(req);
    const deviceId = getFingerprint(req);

    if (!normalizedPhone) {
      return jsonError(res, 400, "Valid phone number required");
    }

    await assertCanSendOtp({ phone: normalizedPhone, ip, deviceId });
    await sendVerification(normalizedPhone);
    await recordOtpSend({ phone: normalizedPhone, ip, deviceId });

    res.json({
      success: true,
      message: "OTP sent successfully",
      data: {
        resendAfter: Math.ceil(
          Number(process.env.OTP_RESEND_COOLDOWN_MS || 45 * 1000) / 1000
        ),
      },
    });

  } catch (err) {
    if (err.statusCode === 429) {
      logger.warn("OTP send blocked", {
        err,
        ip: getClientIp(req),
      });
      return jsonError(res, err.statusCode, err.message, {
        code: err.code,
        retryAfter: err.retryAfter,
      });
    }

    const safeError = getSafeTwilioError(err, "Failed to send OTP");
    logger.error("Failed to send OTP", {
      err,
      status: safeError.status,
      twilioCode: err?.code,
    });

    return jsonError(res, safeError.status, safeError.message);
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhoneNumber(phone);
    const ip = getClientIp(req);
    const deviceId = getFingerprint(req);

    if (!normalizedPhone) {
      return jsonError(res, 400, "Valid phone required");
    }

    if (!isValidOtpCode(otp)) {
      await recordOtpVerifyFailure({
        phone: normalizedPhone,
        ip,
        deviceId,
        reason: "invalid_format",
      });
      return jsonError(res, 400, "Valid OTP required");
    }

    await assertCanVerifyOtp({ phone: normalizedPhone, ip, deviceId });

    const verificationCheck = await checkVerification(
      normalizedPhone,
      String(otp).trim()
    );

    if (verificationCheck.status !== "approved") {
      await recordOtpVerifyFailure({
        phone: normalizedPhone,
        ip,
        deviceId,
        reason: "twilio_not_approved",
      });
      return jsonError(res, 401, "Invalid or expired OTP");
    }

    await ensureAuthHardeningSchema();
    const { user, isNewUser } = await findOrCreateUserByPhone(normalizedPhone);

    await recordOtpVerifySuccess({ phone: normalizedPhone, ip, deviceId });
    await createAuthenticatedSession(req, res, user);

    return res.json({
      success: true,
      message: "OTP verified successfully",
      data: {
        user,
        isNewUser,
      },
    });

  } catch (err) {
    if (err.statusCode === 429) {
      logger.warn("OTP verification blocked", {
        err,
        ip: getClientIp(req),
      });
      return jsonError(res, err.statusCode, err.message, {
        code: err.code,
        retryAfter: err.retryAfter,
      });
    }

    const safeError = getSafeTwilioError(err, "OTP verification failed");
    logger.error("OTP verification failed", {
      err,
      status: safeError.status,
      twilioCode: err?.code,
    });

    return jsonError(res, safeError.status, safeError.message);
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const { credential } = req.body || {};

    await ensureAuthHardeningSchema();
    const googleProfile = await verifyGoogleIdToken(credential);
    const {
      user,
      isNewUser,
      linkedExistingUser,
    } = await findOrCreateUserByGoogleIdentity(googleProfile);

    await createAuthenticatedSession(req, res, user);

    return res.json({
      success: true,
      message: linkedExistingUser
        ? "Google account linked successfully"
        : "Google login successful",
      data: {
        user,
        isNewUser,
        linkedExistingUser,
      },
    });
  } catch (err) {
    logger.warn("Google login failed", {
      err,
      reason: err.reason,
      ip: getClientIp(req),
    });

    if (err.statusCode) {
      return jsonError(res, err.statusCode, err.message, { code: err.reason });
    }

    if (isIdentityUniqueViolation(err)) {
      return jsonError(res, 409, getIdentityConflictMessage(err));
    }

    return jsonError(res, 500, "Google login failed");
  }
};

exports.setRole = async (req, res) => {
  try {
    const userId = req.user.id;
    const { role } = req.body;

    if (!isProvided(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required",
        data: null,
      });
    }

    const currentUser = await pool.query(
      "SELECT id, role FROM users WHERE id=$1",
      [userId]
    );

    if (!currentUser.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    const {
      allowed: roleAllowed,
      onboarding,
      privileged: privilegedRole,
      reason,
      role: normalizedRole,
    } = validateOnboardingRoleSelection(role, currentUser.rows[0].role);

    if (!roleAllowed) {
      if (privilegedRole) {
        logger.security("Blocked role selection", {
          reason,
          userId,
          requestedRole: normalizedRole,
          currentRole: currentUser.rows[0].role,
          ip: getClientIp(req),
        });
      }

      return res.status(400).json({
        success: false,
        message: "Invalid self-service role",
        data: null,
      });
    }

    const result = await pool.query(
      `UPDATE users SET role=$1 WHERE id=$2 RETURNING id, role, auth_session_version`,
      [normalizedRole, userId]
    );

    const updatedUser = result.rows[0];

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    // 🔥 Regenerate access token with updated role
    const accessToken = generateAccessToken(updatedUser);

    setAccessCookie(res, accessToken);

    return res.json({
      success: true,
      message: onboarding
        ? "Onboarding role selected successfully"
        : "Role set successfully",
      data: {
        user: updatedUser,
      },
    });

  } catch (err) {
    logger.error("Failed to set role", { err, userId: req.user?.id });

    res.status(500).json({
      success: false,
      message: "Failed to set role",
      data: null,
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    await ensureAuthHardeningSchema();
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      logger.security("Refresh token attempt failed", {
        reason: "missing_refresh_token",
        ip: getClientIp(req),
      });
      return rejectRefreshToken(res, "Refresh token required");
    }

    let verifiedRefreshToken;
    try {
      verifiedRefreshToken = verifyRefreshToken(refreshToken);
    } catch (err) {
      logger.security("Refresh token attempt failed", {
        reason:
          err instanceof TokenVerificationError
            ? err.reason
            : "refresh_token_validation_exception",
        ip: getClientIp(req),
      });

      return rejectRefreshToken(res, "Invalid refresh token");
    }

    const refreshTokenHash = hashRefreshToken(verifiedRefreshToken);
    const fingerprint = getSessionFingerprint(req);

    const result = await pool.query(
      `
      SELECT id, role, refresh_token, refresh_token_expiry, refresh_token_device,
             auth_session_version
      FROM users
      WHERE refresh_token=$1 OR refresh_token=$2
      `,
      [verifiedRefreshToken, refreshTokenHash]
    );

    if (!result.rows.length) {
      const reusedSession = await getRecentlyRotatedRefreshTokenWithRetry(
        verifiedRefreshToken
      );

      if (reusedSession?.fingerprint === fingerprint) {
        setAuthCookies(res, reusedSession);
        return res.json({ success: true });
      }

      if (reusedSession?.userId) {
        await pool.query(
          `
          UPDATE users
          SET refresh_token=NULL,
              refresh_token_expiry=NULL,
              refresh_token_device=NULL,
              refresh_token_family=NULL
          WHERE id=$1
          `,
          [reusedSession.userId]
        );
      }

      logger.security("Refresh token replay blocked", {
        reason: "refresh_reuse_detected",
        ip: getClientIp(req),
      });

      return rejectRefreshToken(res, "Invalid refresh token");
    }

    const user = result.rows[0];

    if (new Date(user.refresh_token_expiry) < new Date()) {
      logger.security("Refresh token attempt failed", {
        reason: "expired_refresh_token",
        userId: user.id,
        ip: getClientIp(req),
      });

      return rejectRefreshToken(res, "Refresh token expired");
    }

    // 🔁 Rotate refresh token
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
    const expiry = getRefreshExpiry();

    const updateResult = await pool.query(
      `
      UPDATE users
      SET refresh_token=$1,
          refresh_token_expiry=$2,
          refresh_token_device=$5,
          refresh_token_last_used_at=NOW(),
          last_auth_activity_at=NOW()
      WHERE id=$3
        AND (refresh_token=$4 OR refresh_token=$6)
      RETURNING id
      `,
      [
        newRefreshTokenHash,
        expiry,
        user.id,
        verifiedRefreshToken,
        fingerprint,
        refreshTokenHash,
      ]
    );

    // 🔐 Generate new access token
    if (!updateResult.rows.length) {
      const reusedSession = await getRecentlyRotatedRefreshTokenWithRetry(
        verifiedRefreshToken
      );

      if (reusedSession?.fingerprint === fingerprint) {
        setAuthCookies(res, reusedSession);
        return res.json({ success: true });
      }

      if (reusedSession?.userId) {
        await pool.query(
          `
          UPDATE users
          SET refresh_token=NULL,
              refresh_token_expiry=NULL,
              refresh_token_device=NULL,
              refresh_token_family=NULL
          WHERE id=$1
          `,
          [reusedSession.userId]
        );
      }

      logger.security("Refresh token replay blocked", {
        reason: "refresh_token_already_rotated",
        userId: user.id,
        ip: getClientIp(req),
      });

      return rejectRefreshToken(res, "Refresh token was already rotated");
    }

    const accessToken = generateAccessToken(user);
    const session = {
      accessToken,
      refreshToken: newRefreshToken,
      fingerprint,
      userId: user.id,
    };

    try {
      await rememberRotatedRefreshToken(verifiedRefreshToken, session);
    } catch (err) {
      logger.warn("Unable to store refresh reuse grace entry", { err });
    }

    // 🍪 Set cookies (IMPORTANT FIX)
    setAuthCookies(res, session);

    return res.json({ success: true });

  } catch (err) {
    logger.error("Token refresh failed", { err });

    res.status(500).json({
      error: "Token refresh failed",
    });
  }
};

exports.completeProfile = async (req, res) => {
  try {
    await ensureAuthHardeningSchema();
    const authenticatedUserId = req.user?.id;

    if (!authenticatedUserId) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const {
      phone,
      name,
      email,
      role,
      address,
      latitude,
      longitude,
    } = req.body;

    if (
      !isProvided(phone) ||
      !isProvided(name) ||
      !isProvided(email) ||
      !isProvided(role) ||
      !isProvided(address)
    ) {
      return res.status(400).json({
        error: "Phone, name, email, role, and address are required",
      });
    }

    const normalizedPhone = normalizeRequiredPhone(phone);

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "Invalid email",
      });
    }

    const {
      allowed: roleAllowed,
      privileged: privilegedRole,
      reason,
      role: normalizedRole,
    } = validateOnboardingRoleSelection(role);

    if (!roleAllowed) {
      if (privilegedRole) {
        logger.security("Blocked invalid role during profile completion", {
          reason,
          requestedRole: normalizedRole,
          phone: normalizedPhone,
          ip: getClientIp(req),
        });
      }

      return res.status(400).json({
        error: "Invalid self-service role",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const currentUserResult = await pool.query(
      `
      SELECT id, phone, email, google_id, auth_provider, email_verified
      FROM users
      WHERE id=$1
      `,
      [authenticatedUserId]
    );
    const currentUser = currentUserResult.rows[0];

    if (!currentUser) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    if (currentUser.phone) {
      try {
        assertProfilePhoneMatchesAuthenticatedUser({
          submittedPhone: normalizedPhone,
          authenticatedPhone: currentUser.phone,
        });
      } catch (err) {
        logger.security("Blocked profile completion phone mismatch", {
          reason: err.reason || "profile_phone_mismatch",
          userId: authenticatedUserId,
          ip: getClientIp(req),
        });

        return res.status(err.statusCode || 403).json({
          error: err.message || "Profile phone does not match authenticated user",
        });
      }
    } else {
      await ensurePhoneAvailable(
        pool,
        normalizedPhone,
        authenticatedUserId,
        getPhoneLookupValues(normalizedPhone)
      );
    }

    await ensureEmailAvailable(pool, normalizedEmail, authenticatedUserId);

    if (
      currentUser.google_id &&
      currentUser.email &&
      normalizeEmail(currentUser.email) !== normalizedEmail
    ) {
      return res.status(400).json({
        error: "Google account email cannot be changed during onboarding",
      });
    }

    const normalizedName = normalizePersonName(name);
    const normalizedAddress = normalizeRequiredAddress(address);

    const hasLatitude = isProvided(latitude);
    const hasLongitude = isProvided(longitude);

    if (hasLatitude !== hasLongitude) {
      return res.status(400).json({
        error:
          "Both latitude and longitude must be provided",
      });
    }

    if (hasLatitude && !isValidLatitude(latitude)) {
      return res.status(400).json({
        error: "Invalid latitude",
      });
    }

    if (hasLongitude && !isValidLongitude(longitude)) {
      return res.status(400).json({
        error: "Invalid longitude",
      });
    }

    const latitudeValue = hasLatitude ? toNumber(latitude) : null;
    const longitudeValue = hasLongitude ? toNumber(longitude) : null;
    const hasLocation = hasLatitude && hasLongitude;

    const result = await pool.query(
      `
      UPDATE users
      SET
        name = $1,
        email = $2,
        role = $3,
        address = $4,
        latitude = $5,
        longitude = $6,
        location = $7,
        is_verified = true,
        phone = $8,
        auth_provider = COALESCE(auth_provider, $9),
        email_verified = CASE WHEN google_id IS NOT NULL THEN email_verified ELSE false END
      WHERE id = $10
      RETURNING
        id,
        name,
        phone,
        email,
        role,
        address,
        latitude,
        longitude,
        auth_session_version,
        auth_provider,
        email_verified,
        phone_verified_at,
        profile_image_url,
        profile_image_public_id
      `,
      [
        normalizedName,
        normalizedEmail,
        normalizedRole,
        normalizedAddress,
        latitudeValue,
        longitudeValue,

        hasLocation
          ? `SRID=4326;POINT(${longitudeValue} ${latitudeValue})`
          : null,
        normalizedPhone,
        currentUser.auth_provider || "otp",
        authenticatedUserId,
      ]
    );
    const user = result.rows[0];

    await createAuthenticatedSession(req, res, user);

    // 🍪 SET COOKIES (FIX)
    // ✅ SEND CLEAN RESPONSE
    res.json({
      user,
    });

  } catch (err) {
    logger.error("Profile completion failed", { err });

    if (err.statusCode === 409) {
      return res.status(409).json({
        error: err.message,
      });
    }

    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
      });
    }

    if (isIdentityUniqueViolation(err)) {
      return res.status(409).json({
        error: getIdentityConflictMessage(err),
      });
    }

    res.status(500).json({
      error: "Profile completion failed",
    });
  }
};

exports.updateLocation = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const role = req.user.role;

    const {
      address,
      latitude,
      longitude,
    } = req.body;

    if (!isProvided(latitude) || !isProvided(longitude)) {
      return res.status(400).json({
        error:
          "Latitude and longitude required",
      });
    }

    if (!isValidLatitude(latitude)) {
      return res.status(400).json({
        error: "Invalid latitude",
      });
    }

    if (!isValidLongitude(longitude)) {
      return res.status(400).json({
        error: "Invalid longitude",
      });
    }

    const latitudeValue = toNumber(latitude);
    const longitudeValue = toNumber(longitude);
    const normalizedAddress = normalizeAddress(address);

    await client.query("BEGIN");

    const result = await client.query(
      `
      UPDATE users
      SET
        address = $1,
        latitude = $2,
        longitude = $3,
        location = ST_SetSRID(
          ST_MakePoint($3,$2),
          4326
        )::geography
      WHERE id = $4
      RETURNING
        id,
        address,
        latitude,
        longitude
      `,
      [
        normalizedAddress,
        latitudeValue,
        longitudeValue,
        userId,
      ]
    );

    if (role === "ngo") {
      await client.query(
        `
        UPDATE ngos
        SET
          latitude = $1,
          longitude = $2,
          location = ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
        WHERE user_id = $3
        `,
        [latitudeValue, longitudeValue, userId]
      );
    }

    if (role === "provider") {
      await client.query(
        `
        UPDATE restaurants
        SET
          latitude = $1,
          longitude = $2,
          location = ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
        WHERE user_id = $3
        `,
        [latitudeValue, longitudeValue, userId]
      );
    }

    await client.query("COMMIT");

    res.json({
      message:
        "Location updated successfully",
      user: result.rows[0],
    });

  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Location update failed", { err, userId: req.user?.id });

    res.status(500).json({
      error:
        "Failed to update location",
    });
  } finally {
    client.release();
  }
};

// GET ME
exports.getMe = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.email_verified,
        u.auth_provider,
        u.phone_verified_at,
        u.role,
        u.profile_image_url,
        u.profile_image_public_id,
        COALESCE(u.profile_image_url, u.profile_image) AS profile_image,
        u.latitude,
        u.longitude,
        u.reliability_deposit_amount,
        u.requires_reliability_deposit,
        u.restriction_level,
        u.restriction_reason,
        u.cooldown_until,
        u.banned_until,
        u.trust_score,
        u.restriction_type,
        CASE
          WHEN u.role = 'ngo' THEN COALESCE((
            SELECT n.is_verified
            FROM ngos n
            WHERE n.user_id = u.id
            ORDER BY n.id DESC
            LIMIT 1
          ), false)
          WHEN u.role = 'provider' THEN COALESCE((
            SELECT r.is_verified
            FROM restaurants r
            WHERE r.user_id = u.id
            ORDER BY r.id DESC
            LIMIT 1
          ), false)
          ELSE u.is_verified
        END AS is_verified,
        CASE
          WHEN u.role = 'ngo' THEN (
            SELECT n.rejection_reason
            FROM ngos n
            WHERE n.user_id = u.id
            ORDER BY n.id DESC
            LIMIT 1
          )
          WHEN u.role = 'provider' THEN (
            SELECT r.rejection_reason
            FROM restaurants r
            WHERE r.user_id = u.id
            ORDER BY r.id DESC
            LIMIT 1
          )
          ELSE NULL
        END AS rejection_reason,
        CASE
          WHEN u.role = 'ngo' AND NOT EXISTS (
            SELECT 1 FROM ngos n WHERE n.user_id = u.id
          ) THEN 'unregistered'
          WHEN u.role = 'provider' AND NOT EXISTS (
            SELECT 1 FROM restaurants r WHERE r.user_id = u.id
          ) THEN 'unregistered'
          WHEN u.role = 'ngo' AND EXISTS (
            SELECT 1 FROM ngos n
            WHERE n.user_id = u.id
              AND n.is_verified = true
          ) THEN 'approved'
          WHEN u.role = 'provider' AND EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.user_id = u.id
              AND r.is_verified = true
          ) THEN 'approved'
          WHEN u.role = 'ngo' AND EXISTS (
            SELECT 1 FROM ngos n
            WHERE n.user_id = u.id
              AND n.is_verified = false
              AND n.rejection_reason IS NOT NULL
          ) THEN 'rejected'
          WHEN u.role = 'provider' AND EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.user_id = u.id
              AND r.is_verified = false
              AND r.rejection_reason IS NOT NULL
          ) THEN 'rejected'
          WHEN u.role IN ('ngo', 'provider') THEN 'pending'
          ELSE 'approved'
        END AS verification_status,
        u.created_at
      FROM users u
      WHERE u.id=$1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json({
      success: true,
      user: result.rows[0],
    });

  } catch (err) {
    logger.error("Failed to fetch current user", { err, userId: req.user?.id });

    res.status(500).json({
      error: "Failed to fetch user",
    });
  }
};

// LOGOUT
exports.logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    // 🔒 Optional DB cleanup only if user exists
    if (req.user?.id) {
      await pool.query(
        `
        UPDATE users
        SET refresh_token=NULL,
            refresh_token_expiry=NULL,
            refresh_token_device=NULL,
            refresh_token_family=NULL,
            auth_session_version=auth_session_version + 1
        WHERE id=$1
      `,
      [req.user.id]
    );
    } else if (refreshToken) {
      let verifiedRefreshToken = null;

      try {
        verifiedRefreshToken = verifyRefreshToken(refreshToken);
      } catch (err) {
        logger.security("Logout refresh token cleanup skipped", {
          reason:
            err instanceof TokenVerificationError
              ? err.reason
              : "refresh_token_validation_exception",
          ip: getClientIp(req),
        });
      }

      if (verifiedRefreshToken) {
        await pool.query(
          `
          UPDATE users
          SET refresh_token=NULL,
              refresh_token_expiry=NULL,
              refresh_token_device=NULL,
              refresh_token_family=NULL,
              auth_session_version=auth_session_version + 1
          WHERE refresh_token=$1 OR refresh_token=$2
          `,
          [verifiedRefreshToken, hashRefreshToken(verifiedRefreshToken)]
        );
      }
    }

    // 🍪 Always clear cookies
    clearAuthCookies(res);

    return res.json({
      success: true,
      message: "Logged out successfully",
      data: null,
    });

  } catch (err) {
    logger.error("Logout failed", { err, userId: req.user?.id });
    clearAuthCookies(res);
    res.status(500).json({
      success: false,
      message: "Logout failed",
      error: "Logout failed",
      data: null,
    });
  }
};
