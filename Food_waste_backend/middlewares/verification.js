const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");

exports.requireVerified = async (req, res, next) => {
  try {
    const { id, role } = req.user;
    const allowedRoles = ["user", "volunteer", "ngo", "provider"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: "Invalid user role",
      });
    }

    // ✅ Users & Volunteers → always allowed
    if (role === "user" || role === "volunteer") {
      return next();
    }

    let query;
    let errorMessage;

    // 🔹 NGO check
    if (role === "ngo") {
      query = `SELECT is_verified FROM ngos WHERE user_id = $1`;
      errorMessage = "NGO not verified yet";
    }

    // 🔹 Provider (Restaurant) check
    if (role === "provider") {
      query = `SELECT is_verified FROM restaurants WHERE user_id = $1`;
      errorMessage = "Restaurant not verified yet";
    }

    const result = await pool.query(query, [id]);

    // ❌ Not onboarded OR not verified
    if (!result.rows.length || !result.rows[0].is_verified) {
      return res.status(403).json({
        error: errorMessage,
      });
    }

    // ✅ Verified
    next();

  } catch (err) {
    logger.error("Verification check failed", {
      err,
      userId: req.user?.id,
      role: req.user?.role,
    });
    res.status(500).json({
      error: "Verification check failed",
    });
  }
};
