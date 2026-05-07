const pool = require("../shared/config/db");
const { isValidId } = require("../utils/validation");

const CO2_PER_MEAL_KG = 0.5;

const sendQueryResult = (res, result) => {
  res.json(result.rows[0]);
};

exports.getSummary = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(r.id) AS total_pickups,
        COALESCE(SUM(r.quantity_reserved),0) AS total_meals_saved,
        COALESCE(SUM(r.quantity_reserved) * $1,0) AS estimated_co2_saved,
        COUNT(*) FILTER (WHERE r.pickup_type='self_pickup') AS self_pickups,
        COUNT(*) FILTER (WHERE r.pickup_type='ngo') AS ngo_pickups,
        COALESCE(SUM(r.quantity_reserved) FILTER (WHERE r.pickup_type='ngo'),0) AS ngo_meals_rescued
      FROM reservations r
      WHERE r.status='picked_up'
      `,
      [CO2_PER_MEAL_KG],
    );

    sendQueryResult(res, result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch impact summary" });
  }
};

exports.getUserImpact = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "User id is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(*) AS total_pickups,
        COALESCE(SUM(quantity_reserved),0) AS total_meals_saved,
        COALESCE(SUM(quantity_reserved) * $2,0) AS estimated_co2_saved,
        COUNT(*) FILTER (WHERE pickup_type='self_pickup') AS self_pickups,
        COUNT(*) FILTER (WHERE pickup_type='ngo') AS ngo_pickups,
        COALESCE(SUM(quantity_reserved) FILTER (WHERE pickup_type='self_pickup'),0) AS self_pickup_meals,
        COALESCE(SUM(quantity_reserved) FILTER (WHERE pickup_type='ngo'),0) AS ngo_meals_rescued
      FROM reservations
      WHERE status='picked_up'
      AND user_id=$1;
      `,
      [id, CO2_PER_MEAL_KG],
    );

    sendQueryResult(res, result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user impact" });
  }
};

exports.getListingImpact = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(r.id) AS total_pickups,
        COALESCE(SUM(r.quantity_reserved),0) AS total_meals_saved,
        COALESCE(SUM(r.quantity_reserved) * $2,0) AS estimated_co2_saved
      FROM reservations r
      WHERE r.status='picked_up'
      AND r.listing_id=$1
      `,
      [id, CO2_PER_MEAL_KG],
    );

    sendQueryResult(res, result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch listing impact" });
  }
};

exports.getNGOImpact = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "NGO id is required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(r.id) AS total_pickups,
        COALESCE(SUM(r.quantity_reserved),0) AS total_meals_saved,
        COALESCE(SUM(r.quantity_reserved) * $2,0) AS estimated_co2_saved,
        COUNT(r.id) FILTER (WHERE r.assigned_volunteer_id IS NOT NULL) AS delivery_pickups,
        COALESCE(SUM(r.quantity_reserved) FILTER (WHERE r.assigned_volunteer_id IS NOT NULL),0) AS delivery_meals_rescued
      FROM reservations r
      JOIN ngos n ON n.user_id = r.user_id
      WHERE r.status='picked_up'
      AND r.pickup_type='ngo'
      AND n.id=$1
      `,
      [id, CO2_PER_MEAL_KG],
    );

    sendQueryResult(res, result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch NGO impact" });
  }
};
