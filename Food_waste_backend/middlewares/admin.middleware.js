const logger = require("../shared/utils/logger");
const { assertAdmin } = require("../shared/services/authorization.service");

module.exports = async (req, res, next) => {
  try {
    const context = await assertAdmin({ userId: req.user.id });
    req.authorization = context;
    req.user.role = context.role;

    next();
  } catch (err) {
    logger.security("Admin authorization failed", {
      err,
      reason: err.reason || "admin_authorization_failed",
      userId: req.user?.id,
      role: req.user?.role,
      path: req.originalUrl,
      ip: req.ip,
    });

    return res.status(err.statusCode || 403).json({
      success: false,
      message: "Admin access required",
      data: null,
    });
  }
};
