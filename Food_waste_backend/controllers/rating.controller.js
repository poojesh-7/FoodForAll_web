const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { sanitizeOptionalText } = require("../shared/utils/sanitize");
const { isProvided, isValidId, toNumber } = require("../utils/validation");

const REVIEW_MAX_LENGTH = 500;
const REVIEWER_ROLES = new Set(["user", "ngo"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const withStatus = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

function parseRating(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return toNumber(value.trim());
  }
  return NaN;
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value));
}

function isReservationReviewEligible(reservation) {
  if (reservation.pickup_type === "self_pickup") {
    return reservation.status === "picked_up" || Boolean(reservation.completed_at);
  }

  if (reservation.pickup_type === "ngo") {
    return reservation.task_status === "delivered" || Boolean(reservation.completed_at);
  }

  return false;
}

exports.createRating = async (req, res) => {
  const { reservation_id, rating, review } = req.body;
  const userId = req.user.id;
  const ratingValue = parseRating(rating);

  if (!REVIEWER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: "Only reservation owners can review providers" });
  }

  if (
    !isValidId(reservation_id) ||
    !isUuid(reservation_id) ||
    !isProvided(rating)
  ) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
    return res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
  }

  const sanitizedReview = isProvided(review)
    ? sanitizeOptionalText(review, {
        maxLength: REVIEW_MAX_LENGTH,
        preserveNewlines: true,
      })
    : null;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reservationResult = await client.query(
      `
      SELECT r.*, f.provider_id, f.is_free
      FROM reservations r
      JOIN food_listings f ON f.id = r.listing_id
      WHERE r.id=$1
      FOR UPDATE
      `,
      [reservation_id]
    );

    if (!reservationResult.rows.length) {
      throw withStatus("Reservation not found", 404);
    }

    const reservation = reservationResult.rows[0];

    if (String(reservation.user_id) !== String(userId)) {
      throw withStatus("Only the reservation owner can review", 403);
    }

    if (String(reservation.provider_id) === String(userId)) {
      throw withStatus("Providers cannot review their own listings", 403);
    }

    if (!isReservationReviewEligible(reservation)) {
      throw withStatus("Reservation is not eligible for review yet", 403);
    }

    if (
      reservation.payment_status !== "not_required" &&
      reservation.payment_status !== "paid"
    ) {
      throw withStatus("Paid reservations must be paid before review", 403);
    }

    const result = await client.query(
      `
      INSERT INTO ratings (reservation_id, listing_id, reviewer_id, rating, review)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [
        reservation.id,
        reservation.listing_id,
        userId,
        ratingValue,
        sanitizedReview,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");

    if (err.code === "23505") {
      return res.status(409).json({ error: "Already reviewed this reservation" });
    }

    res.status(err.statusCode || 400).json({
      error: err.message || "Rating failed",
    });
  } finally {
    client.release();
  }
};

exports.updateRating = async (req, res) => {
  const { id } = req.params;
  const { rating, review } = req.body;
  const userId = req.user.id;
  const ratingValue = parseRating(rating);

  if (!REVIEWER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: "Only reservation owners can review providers" });
  }

  if (!isValidId(id) || !isUuid(id) || !isProvided(rating)) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
    return res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
  }

  const sanitizedReview = isProvided(review)
    ? sanitizeOptionalText(review, {
        maxLength: REVIEW_MAX_LENGTH,
        preserveNewlines: true,
      })
    : null;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
      SELECT rt.*, res.pickup_type, res.status, res.task_status, res.completed_at,
             res.payment_status, res.user_id, f.provider_id
      FROM ratings rt
      JOIN reservations res ON res.id = rt.reservation_id
      JOIN food_listings f ON f.id = rt.listing_id
      WHERE rt.id=$1
      FOR UPDATE OF rt
      `,
      [id]
    );

    if (!existingResult.rows.length) {
      throw withStatus("Review not found", 404);
    }

    const existing = existingResult.rows[0];

    if (String(existing.reviewer_id) !== String(userId)) {
      throw withStatus("Only the reviewer can edit this review", 403);
    }

    if (String(existing.user_id) !== String(userId)) {
      throw withStatus("Only the reservation owner can edit this review", 403);
    }

    if (String(existing.provider_id) === String(userId)) {
      throw withStatus("Providers cannot review their own listings", 403);
    }

    if (!isReservationReviewEligible(existing)) {
      throw withStatus("Reservation is not eligible for review", 403);
    }

    if (
      existing.payment_status !== "not_required" &&
      existing.payment_status !== "paid"
    ) {
      throw withStatus("Paid reservations must be paid before review", 403);
    }

    const result = await client.query(
      `
      UPDATE ratings
      SET rating=$2,
          review=$3
      WHERE id=$1
      RETURNING *
      `,
      [id, ratingValue, sanitizedReview]
    );

    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(err.statusCode || 400).json({
      error: err.message || "Review update failed",
    });
  } finally {
    client.release();
  }
};

exports.getListingRatings = async (req, res) => {
  const { listingId } = req.params;

  if (!isValidId(listingId)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        r.id,
        r.rating,
        r.review,
        r.created_at,
        u.name,
        u.profile_image_url AS reviewer_profile_image_url
      FROM ratings r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.listing_id=$1
      ORDER BY r.created_at DESC
      `,
      [listingId]
    );

    res.json(result.rows);
  } catch (err) {
    logger.error("Failed to fetch listing ratings", { err, listingId });
    res.status(500).json({ error: "Failed to fetch ratings" });
  }
};

exports.getProviderRatings = async (req, res) => {
  const { providerId } = req.params;

  if (!isValidId(providerId)) {
    return res.status(400).json({ error: "Provider id is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::double precision AS "averageRating",
        COUNT(r.id)::int AS "totalReviews",
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::double precision AS average_rating,
        COUNT(r.id)::int AS total_reviews
      FROM ratings r
      JOIN food_listings f ON r.listing_id = f.id
      WHERE f.provider_id=$1
      `,
      [providerId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("Failed to fetch provider ratings", { err, providerId });
    res.status(500).json({ error: "Failed to fetch provider ratings" });
  }
};
