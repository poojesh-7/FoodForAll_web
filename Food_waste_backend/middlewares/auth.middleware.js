const jwt = require("jsonwebtoken");
const { isValidId } = require("../utils/validation");
const logger = require("../shared/utils/logger");
const { mergeContext } = require("../shared/utils/requestContext");

function unauthorized(req, res, message, reason) {
  logger.security("Authentication failed", {
    reason,
    path: req.originalUrl,
    ip: req.ip,
  });
  return res.status(401).json({
    success: false,
    message,
    data: null,
  });
}

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  const token = bearerToken || req.cookies?.accessToken;

  if (!token) return unauthorized(req, res, "Authentication token is required", "missing_token");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.id || !isValidId(decoded.id)) {
      return unauthorized(req, res, "Authentication token is invalid", "invalid_user_id");
    }

    req.user = decoded;
    mergeContext({ userId: decoded.id, role: decoded.role });
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return unauthorized(req, res, "Authentication token has expired", "expired_token");
    }

    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
      return unauthorized(req, res, "Authentication token is invalid", "invalid_token");
    }

    return unauthorized(req, res, "Authentication failed", "auth_exception");
  }
};
