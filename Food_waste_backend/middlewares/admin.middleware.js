const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");

module.exports = async (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
      data: null,
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, role, is_verified FROM users WHERE id=$1`,
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user || user.role !== "admin" || user.is_verified === false) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
        data: null,
      });
    }

    next();
  } catch (err) {
    logger.error("Admin verification failed", { err, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: "Admin verification failed",
      data: null,
    });
  }
};
