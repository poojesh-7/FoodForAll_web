const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const {
  deleteProfileImage,
  uploadProfileImage: uploadProfileImageAsset,
} = require("../shared/services/profileMedia.service");
const {
  ensureEmailAvailable,
  getIdentityConflictMessage,
  isIdentityUniqueViolation,
  normalizeEmail,
} = require("../utils/identity");
const { isProvided, isValidEmail, isValidId } = require("../utils/validation");
const {
  normalizePersonName,
} = require("../utils/fieldValidation");

// GET USER
exports.getUser = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  if (String(req.user.id) !== String(id) && req.user.role !== "admin") {
    logger.security("Blocked user profile read", {
      requesterId: req.user?.id,
      targetUserId: id,
      role: req.user?.role,
      path: req.originalUrl,
      ip: req.ip,
    });
    return res.status(403).json({ error: "Unauthorized" });
  }

  const result = await pool.query(
    `
    SELECT id,
           name,
           phone,
           email,
           role,
           profile_image_url,
           profile_image_public_id,
           COALESCE(profile_image_url, profile_image) AS profile_image,
           created_at
    FROM users
    WHERE id=$1
    `,
    [id],
  );

  if (result.rows.length === 0)
    return res.status(404).json({ error: "User not found" });

  res.json(result.rows[0]);
};

// UPDATE USER
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;

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
    const currentUser = await pool.query(
      "SELECT id, email, google_id FROM users WHERE id=$1",
      [id],
    );

    if (!currentUser.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    if (
      currentUser.rows[0].google_id &&
      normalizedEmail &&
      normalizeEmail(currentUser.rows[0].email) !== normalizedEmail
    ) {
      return res.status(400).json({
        error: "Google account email cannot be changed",
      });
    }

    const normalizedName = isProvided(name) ? normalizePersonName(name) : null;

    await ensureEmailAvailable(pool, normalizedEmail, id);

    const result = await pool.query(
      `UPDATE users
       SET name=$1, email=$2
       WHERE id=$3
       RETURNING id,
                 name,
                 email,
                 role,
                 profile_image_url,
                 profile_image_public_id,
                 COALESCE(profile_image_url, profile_image) AS profile_image`,
      [normalizedName, normalizedEmail, id],
    );

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("User update failed", { err, userId: req.user?.id });

    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message });
    }

    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }

    if (isIdentityUniqueViolation(err)) {
      return res.status(409).json({
        error: getIdentityConflictMessage(err),
      });
    }

    res.status(500).json({ error: "User update failed" });
  }
};

exports.uploadProfileImage = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  if (String(req.user.id) !== String(id)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Profile image is required" });
  }

  let uploaded = null;

  try {
    const current = await pool.query(
      `
      SELECT id, name, email, role, profile_image_public_id
      FROM users
      WHERE id=$1
      `,
      [id],
    );

    if (!current.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    uploaded = await uploadProfileImageAsset(id, req.file);

    const result = await pool.query(
      `
      UPDATE users
      SET profile_image_url=$1,
          profile_image_public_id=$2,
          profile_image=$1
      WHERE id=$3
      RETURNING id,
                name,
                email,
                role,
                profile_image_url,
                profile_image_public_id,
                COALESCE(profile_image_url, profile_image) AS profile_image
      `,
      [uploaded.profile_image_url, uploaded.profile_image_public_id, id],
    );

    const previousPublicId = current.rows[0].profile_image_public_id;

    if (previousPublicId) {
      await deleteProfileImage(previousPublicId).catch((err) => {
        logger.warn("Profile image cleanup failed", {
          err,
          userId: id,
          publicId: previousPublicId,
        });
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (uploaded?.profile_image_public_id) {
      await deleteProfileImage(uploaded.profile_image_public_id).catch((deleteErr) => {
        logger.warn("Uploaded profile image cleanup failed", {
          err: deleteErr,
          userId: id,
          publicId: uploaded.profile_image_public_id,
        });
      });
    }

    logger.error("Profile image upload failed", { err, userId: req.user?.id });

    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : "Profile image upload failed",
    });
  }
};

exports.removeProfileImage = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  if (String(req.user.id) !== String(id)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const current = await pool.query(
      `
      SELECT id, profile_image_public_id
      FROM users
      WHERE id=$1
      `,
      [id],
    );

    if (!current.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET profile_image_url=NULL,
          profile_image_public_id=NULL,
          profile_image=NULL
      WHERE id=$1
      RETURNING id,
                name,
                email,
                role,
                profile_image_url,
                profile_image_public_id,
                COALESCE(profile_image_url, profile_image) AS profile_image
      `,
      [id],
    );

    const previousPublicId = current.rows[0].profile_image_public_id;

    if (previousPublicId) {
      await deleteProfileImage(previousPublicId).catch((err) => {
        logger.warn("Profile image delete failed", {
          err,
          userId: id,
          publicId: previousPublicId,
        });
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("Profile image removal failed", { err, userId: req.user?.id });

    res.status(500).json({ error: "Profile image removal failed" });
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
      `SELECT r.*, f.title, f.pickup_end_time, f.quantity_unit, f.custom_quantity_unit
       FROM reservations r
       JOIN food_listings f ON r.listing_id = f.id
       WHERE r.user_id=$1
       ORDER BY r.reserved_at DESC`,
      [id],
    );
  }

  res.json(history.rows);
};
