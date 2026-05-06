const pool = require("../shared/config/db");
const { isValidId } = require("../utils/validation");

exports.getSummary = async (req, res) => {
  const result = await pool.query(`
    SELECT 
      COUNT(r.id) AS total_pickups,
      COALESCE(SUM(r.quantity_reserved),0) AS total_meals_saved,
      COALESCE(SUM(r.quantity_reserved) * 0.5,0) AS estimated_co2_saved
    FROM reservations r
    WHERE r.status='picked_up'
  `);

  res.json(result.rows[0]);
};

exports.getUserImpact = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  const result = await pool.query(
    `
   SELECT 
      COUNT(*) AS total_pickups,
      COALESCE(SUM(quantity_reserved),0) AS total_meals_saved,
      COALESCE(SUM(quantity_reserved) * 0.5,0) AS estimated_co2_saved
    FROM reservations
    WHERE status='picked_up'
    AND user_id=$1;
  `,
    [id],
  );

  res.json(result.rows[0]);
};

exports.getListingImpact = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  const result = await pool.query(
    `
    SELECT 
      COUNT(r.id) AS total_pickups,
      COALESCE(SUM(r.quantity_reserved),0) AS total_meals_saved,
      COALESCE(SUM(r.quantity_reserved) * 0.5,0) AS estimated_co2_saved
    FROM reservations r
    WHERE r.status='picked_up'
    AND r.listing_id=$1
  `,
    [id],
  );

  res.json(result.rows[0]);
};

exports.getNGOImpact = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "NGO id is required" });
  }

  const result = await pool.query(
    `
    SELECT 
      COUNT(r.id) AS total_pickups,
      COALESCE(SUM(r.quantity_reserved),0) AS total_meals_saved,
      COALESCE(SUM(r.quantity_reserved) * 0.5,0) AS estimated_co2_saved
    FROM reservations r
    JOIN food_listings f ON r.listing_id = f.id
    WHERE r.status='picked_up'
    AND f.ngo_id=$1
  `,
    [id],
  );

  res.json(result.rows[0]);
};
