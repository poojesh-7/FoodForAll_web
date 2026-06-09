const { isValidId } = require("../utils/validation");
const logger = require("../shared/utils/logger");
const { mergeContext } = require("../shared/utils/requestContext");
const {
  SessionSecurityError,
  assertAccessTokenSession,
} = require("../shared/services/sessionSecurity.service");
const {
  TokenSourceError,
  TokenVerificationError,
  extractAccessTokenFromRequest,
  verifyAccessToken,
} = require("../utils/token");

function unauthorized(req, res, message, reason, meta = {}) {
  logger.security("Authentication failed", {
    reason,
    path: req.originalUrl,
    ip: req.ip,
    ...meta,
  });
  return res.status(401).json({
    success: false,
    message,
    data: null,
  });
}

module.exports = async (req, res, next) => {
  let tokenSource;
  let token;

  try {
    ({ token, source: tokenSource } = extractAccessTokenFromRequest(req));
  } catch (err) {
    if (err instanceof TokenSourceError) {
      return unauthorized(
        req,
        res,
        "Authentication token is invalid",
        err.reason
      );
    }

    return unauthorized(req, res, "Authentication failed", "token_source_exception");
  }

  if (!token) {
    return unauthorized(req, res, "Authentication token is required", "missing_token");
  }

  try {
    const decoded = verifyAccessToken(token);
    if (!decoded?.id || !isValidId(decoded.id)) {
      return unauthorized(
        req,
        res,
        "Authentication token is invalid",
        "invalid_user_id",
        { tokenSource }
      );
    }

    const sessionUser = await assertAccessTokenSession({ decoded });

    req.user = {
      ...decoded,
      role: sessionUser.role,
      auth_session_version: sessionUser.auth_session_version,
    };
    mergeContext({ userId: decoded.id, role: sessionUser.role });
    next();
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      const message =
        err.reason === "expired_token"
          ? "Authentication token has expired"
          : "Authentication token is invalid";

      return unauthorized(req, res, message, err.reason, { tokenSource });
    }

    if (err instanceof SessionSecurityError) {
      return unauthorized(req, res, "Authentication token is invalid", err.reason, {
        tokenSource,
      });
    }

    return unauthorized(req, res, "Authentication failed", "auth_exception", {
      tokenSource,
      err,
    });
  }
};
