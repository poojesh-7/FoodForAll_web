const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const {
  ensureEmailAvailable,
  getIdentityConflictMessage,
  isIdentityUniqueViolation,
  normalizeEmail,
} = require("../utils/identity");
const { isProvided, isValidEmail, isValidId } = require("../utils/validation");

// GET USER
exports.getUser = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  const result = await pool.query(
    "SELECT id, name, phone, email, role, created_at FROM users WHERE id=$1",
    [id],
  );

  if (result.rows.length === 0)
    return res.status(404).json({ error: "User not found" });

  res.json(result.rows[0]);
};

// UPDATE USER
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, email, profile_image } = req.body;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  // Only user can update themselves
  if (String(req.user.id) !== String(id))
    return res.status(403).json({ error: "Unauthorized" });

  if (isProvided(email) && !isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    await ensureEmailAvailable(pool, normalizedEmail, id);

    const result = await pool.query(
      `UPDATE users
       SET name=$1, email=$2, profile_image=$3
       WHERE id=$4
       RETURNING id, name, email, role, profile_image`,
      [name, normalizedEmail, profile_image, id],
    );

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("User update failed", { err, userId: req.user?.id });

    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message });
    }

    if (isIdentityUniqueViolation(err)) {
      return res.status(409).json({
        error: getIdentityConflictMessage(err),
      });
    }

    res.status(500).json({ error: "User update failed" });
  }
};

// USER HISTORY
exports.getUserHistory = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  if (String(req.user.id) !== String(id))
    return res.status(403).json({ error: "Unauthorized" });

  const userResult = await pool.query("SELECT role FROM users WHERE id=$1", [
    id,
  ]);

  const role = userResult.rows[0]?.role;

  let history;

  if (role === "provider") {
    history = await pool.query(
      `SELECT * FROM food_listings
       WHERE provider_id=$1
       ORDER BY created_at DESC`,
      [id],
    );
  } else {
    history = await pool.query(
      `SELECT r.*, f.title, f.pickup_end_time
       FROM reservations r
       JOIN food_listings f ON r.listing_id = f.id
       WHERE r.user_id=$1
       ORDER BY r.reserved_at DESC`,
      [id],
    );
  }

  res.json(history.rows);
};
