const pool = require("../shared/config/db");
const { isProvided, isValidId, toNumber } = require("../utils/validation");

const withStatus = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/*
========================
Create Rating
========================
*/
exports.createRating = async (req, res) => {
  const { listing_id, rating, review } = req.body;
  const user_id = req.user.id;
  const ratingValue = toNumber(rating);

  if (!isValidId(listing_id) || !isProvided(rating)) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!Number.isFinite(ratingValue) || ratingValue < 1 || ratingValue > 5) {
    return res.status(400).json({ error: "Rating must be between 1 and 5" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
    1️⃣ Validate eligibility
    */
    const reservationResult = await client.query(
      `
      SELECT r.*, f.provider_id
      FROM reservations r
      JOIN food_listings f ON f.id = r.listing_id
      WHERE r.listing_id=$1
      AND r.user_id=$2
      AND r.status='picked_up'
      AND r.pickup_type='self'
      LIMIT 1
      `,
      [listing_id, user_id]
    );

    if (!reservationResult.rows.length) {
      throw withStatus("Not eligible to rate", 403);
    }

    const reservation = reservationResult.rows[0];

    /*
    2️⃣ Rating time window (48 hours)
    */
    if (reservation.completed_at) {
      const completedAt = new Date(reservation.completed_at).getTime();
      const now = Date.now();

      if (now - completedAt > 48 * 60 * 60 * 1000) {
        throw withStatus("Rating window expired", 400);
      }
    }

    /*
    3️⃣ Insert rating (unique constraint handles duplicates)
    */
    const result = await client.query(
      `
      INSERT INTO ratings (listing_id, reviewer_id, rating, review)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [listing_id, user_id, ratingValue, review || null]
    );

    /*
    4️⃣ OPTIONAL: Update provider stats (denormalized)
    */
    await client.query(
      `
      UPDATE users u
      SET 
        total_reviews = COALESCE(u.total_reviews, 0) + 1,
        avg_rating = (
          (
            COALESCE(u.avg_rating, 0) * COALESCE(u.total_reviews, 0)
            + $1
          ) / (COALESCE(u.total_reviews, 0) + 1)
        )
      FROM food_listings f
      WHERE f.id = $2
      AND u.id = f.provider_id
      `,
      [ratingValue, listing_id]
    );

    await client.query("COMMIT");

    res.status(201).json(result.rows[0]);

  } catch (err) {
    await client.query("ROLLBACK");

    if (err.code === "23505") {
      return res.status(409).json({ error: "Already rated this listing" });
    }

    res.status(err.statusCode || 400).json({
      error: err.message || "Rating failed",
    });
  } finally {
    client.release();
  }
};



/*
========================
Get Listing Ratings
========================
*/
exports.getListingRatings = async (req, res) => {
  const { listingId } = req.params;

  if (!isValidId(listingId)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        r.rating,
        r.review,
        r.created_at,
        u.name
      FROM ratings r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.listing_id=$1
      ORDER BY r.created_at DESC
      `,
      [listingId]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch ratings" });
  }
};



/*
========================
Get Provider Ratings
========================
*/
exports.getProviderRatings = async (req, res) => {
  const { providerId } = req.params;

  if (!isValidId(providerId)) {
    return res.status(400).json({ error: "Provider id is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        COALESCE(AVG(r.rating), 0) AS average_rating,
        COUNT(r.id) AS total_reviews
      FROM ratings r
      JOIN food_listings f ON r.listing_id = f.id
      WHERE f.provider_id=$1
      `,
      [providerId]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch provider ratings" });
  }
};
