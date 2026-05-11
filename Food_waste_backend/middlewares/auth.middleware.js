const jwt = require("jsonwebtoken");
const { isValidId } = require("../utils/validation");

function unauthorized(res, message) {
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

  if (!token) return unauthorized(res, "Authentication token is required");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.id || !isValidId(decoded.id)) {
      return unauthorized(res, "Authentication token is invalid");
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return unauthorized(res, "Authentication token has expired");
    }

    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
      return unauthorized(res, "Authentication token is invalid");
    }

    return unauthorized(res, "Authentication failed");
  }
};
