const pool = require("../shared/config/db");

const notificationQueue = require("../queues/notification.queue");
const { publishListingUpdated } = require("../shared/services/realtime.service");
const {
  isIntegerInRange,
  isNumberInRange,
  isProvided,
  isValidId,
  isValidLatitude,
  isValidLongitude,
  toNumber,
} = require("../utils/validation");

exports.registerRestaurant = async (req, res) => {
  try {
    const userId = req.user.id;

    // 🔹 Fetch user
    const userResult = await pool.query(
      "SELECT id, role FROM users WHERE id=$1",
      [userId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    if (user.role !== "provider") {
      return res.status(403).json({
        error: "Only providers can register restaurants",
      });
    }

    const {
      restaurant_name,
      fssai_number,
      service_radius_km,
      latitude,
      longitude,
    } = req.body;

    // 🔹 Validation
    if (!isProvided(restaurant_name) || !isProvided(fssai_number)) {
      return res.status(400).json({
        error: "Restaurant name and FSSAI number are required",
      });
    }

    if (!isProvided(latitude) || !isProvided(longitude)) {
      return res.status(400).json({
        error: "Location (latitude & longitude) required",
      });
    }

    if (!isValidLatitude(latitude)) {
      return res.status(400).json({
        error: "Invalid latitude value",
      });
    }

    if (!isValidLongitude(longitude)) {
      return res.status(400).json({
        error: "Invalid longitude value",
      });
    }

    const latitudeValue = toNumber(latitude);
    const longitudeValue = toNumber(longitude);
    const serviceRadius = isProvided(service_radius_km)
      ? toNumber(service_radius_km)
      : 5;

    if (!Number.isFinite(serviceRadius) || serviceRadius <= 0 || serviceRadius > 100) {
      return res.status(400).json({
        error: "Service radius must be between 1 and 100 km",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "FSSAI certificate image required",
      });
    }

    const normalizedName = String(restaurant_name).trim();
    const normalizedFssai = String(fssai_number).trim();

    // 🔹 Check if restaurant already exists for this user
    const existingRestaurant = await pool.query(
      "SELECT id, rejection_reason FROM restaurants WHERE user_id=$1",
      [userId]
    );

    const existing = existingRestaurant.rows[0];

    if (existing && !existing.rejection_reason) {
      return res.status(409).json({
        error: "Restaurant already registered for this user",
      });
    }

    const { uploadBuffer } = require("../shared/services/cloudinary.service");
    const uploadedImage = await uploadBuffer(req.file.buffer, {
      folder: "food-waste/fssai",
      public_id: `provider_${userId}_fssai`,
      overwrite: true,
      invalidate: true,
    });

    const fssaiImagePath = uploadedImage.secure_url;


    // 🔹 Insert
    const result = existing
      ? await pool.query(
          `
          UPDATE restaurants
          SET restaurant_name=$1,
              fssai_number=$2,
              fssai_certificate_url=$3,
              service_radius_km=$4,
              latitude=$5,
              longitude=$6,
              location=ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,
              is_verified=false,
              rejection_reason=NULL
          WHERE id=$7
          RETURNING
            id,
            user_id,
            restaurant_name,
            fssai_number,
            is_verified,
            rejection_reason,
            'pending' AS verification_status
          `,
          [
            normalizedName,
            normalizedFssai,
            fssaiImagePath,
            serviceRadius,
            latitudeValue,
            longitudeValue,
            existing.id,
          ]
        )
      : await pool.query(
          `
          INSERT INTO restaurants (
            user_id,
            restaurant_name,
            fssai_number,
            fssai_certificate_url,
            service_radius_km,
            latitude,
            longitude,
            location,
            is_verified
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,
            false
          )
          RETURNING
            id,
            user_id,
            restaurant_name,
            fssai_number,
            is_verified,
            rejection_reason,
            'pending' AS verification_status
          `,
          [
            userId,
            normalizedName,
            normalizedFssai,
            fssaiImagePath,
            serviceRadius,
            latitudeValue,
            longitudeValue,
          ]
        );

    // keep this (good)
    await pool.query(
      `
      UPDATE users
      SET 
        latitude = $1,
        longitude = $2,
        location = ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
      WHERE id = $3
      `,
      [latitudeValue, longitudeValue, userId]
    );

    res.status(existing ? 200 : 201).json({
      message: existing
        ? "Restaurant verification resubmitted successfully"
        : "Restaurant registered successfully",
      restaurant: result.rows[0],
    });

  } catch (err) {
    console.error(err);

    // 🔹 Duplicate errors
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Restaurant already exists (duplicate entry)",
      });
    }

    res.status(500).json({
      error: "Restaurant registration failed",
    });
  }
};

const expiryQueue = require("../queues/expiry.queue");
const alertQueue = require("../queues/expiryAlert.queue");

exports.createFood = async (req, res) => {
  const client = await pool.connect();

  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can post food" });
    }

    // 🔹 Fetch restaurant location
    const restaurantResult = await client.query(
      `SELECT latitude, longitude FROM restaurants WHERE user_id = $1`,
      [req.user.id]
    );

    if (!restaurantResult.rows.length) {
      return res.status(404).json({ error: "Restaurant profile not found" });
    }

    const { latitude, longitude } = restaurantResult.rows[0];

    let {
      title,
      description,
      quantity,
      price,
      is_free,
      pickup_start_time,
      pickup_end_time,
    } = req.body;

    // 🔹 Normalize
    title = title?.trim();
    description = description?.trim() || null;
    quantity = Number(quantity);
    price = Number(price) || 0;
    is_free = is_free === true || is_free === "true";

    const now = Date.now();
    const startTime = new Date(pickup_start_time).getTime();
    const endTime = new Date(pickup_end_time).getTime();

    /*
    ========================
    VALIDATIONS
    ========================
    */

    if (!isProvided(title) || !isProvided(req.body.quantity) || !isProvided(pickup_end_time)) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!Number.isFinite(endTime) || (isProvided(pickup_start_time) && !Number.isFinite(startTime))) {
      return res.status(400).json({ error: "Invalid pickup time" });
    }

    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1000) {
      return res.status(400).json({ error: "Quantity must be an integer between 1 and 1000" });
    }

    if (startTime && startTime < now) {
      return res.status(400).json({
        error: "Pickup start time cannot be in the past",
      });
    }

    if (startTime && startTime >= endTime) {
      return res.status(400).json({
        error: "Start time must be before end time",
      });
    }

    if (endTime <= now) {
      return res.status(400).json({
        error: "Expiry must be in future",
      });
    }

    if (endTime - now < 30 * 60 * 1000) {
      return res.status(400).json({
        error: "Minimum pickup window is 30 minutes",
      });
    }

    if (is_free && price > 0) {
      return res.status(400).json({
        error: "Free food cannot have price",
      });
    }

    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      return res.status(400).json({
        error: "Invalid price",
      });
    }

    if (!is_free && price <= 0) {
      return res.status(400).json({
        error: "Paid food must have valid price",
      });
    }

    /*
    ========================
    TRANSACTION START
    ========================
    */

    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO food_listings (
        provider_id,
        title,
        description,
        quantity,
        remaining_quantity,
        price,
        is_free,
        pickup_start_time,
        pickup_end_time,
        latitude,
        longitude,
        location,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::double precision,
        $10::double precision,
        ST_SetSRID(
          ST_MakePoint(
            $10::double precision,
            $9::double precision
          ),
          4326
        )::geography,
        'active'
      )
      RETURNING *;
      `,
      [
        req.user.id,
        title,
        description,
        quantity,
        price,
        is_free,
        pickup_start_time,
        pickup_end_time,
        latitude,
        longitude,
      ]
    );

    const listing = result.rows[0];

    /*
    ========================
    QUEUES
    ========================
    */

    const expiryDelay = Math.max(endTime - Date.now(), 0);

    await expiryQueue.add(
      "expire-food",
      { listingId: listing.id },
      { delay: expiryDelay, jobId: `expiry-${listing.id}` }
    );

    const alertDelay = Math.max(endTime - 30 * 60 * 1000 - Date.now(), 0);

    await alertQueue.add(
      "expiry-alert",
      { listingId: listing.id },
      { delay: alertDelay, jobId: `alert-${listing.id}` }
    );

    await client.query("COMMIT");

    // 🔹 Realtime
    req.app.get("io").emit("food:new", listing);
    await publishListingUpdated(listing.id, { action: "created", listing });

    res.status(201).json({
      message: "Food created successfully",
      listing,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    if (err.code === "23505") {
      return res.status(409).json({
        error: "Duplicate listing",
      });
    }

    res.status(500).json({
      error: "Food creation failed",
    });
  } finally {
    client.release();
  }
};

// UPDATE FOOD
exports.updateFood = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Food id is required" });
  }

  const food = await pool.query("SELECT * FROM food_listings WHERE id=$1", [
    id,
  ]);

  if (food.rows.length === 0)
    return res.status(404).json({ error: "Not found" });

  if (food.rows[0].provider_id !== req.user.id)
    return res.status(403).json({ error: "Unauthorized" });

  const { title, description, price, pickup_start_time, pickup_end_time } =
    req.body;
  const priceValue = toNumber(price);
  const startTime = new Date(pickup_start_time).getTime();
  const endTime = new Date(pickup_end_time).getTime();

  if (!isProvided(title) || !isProvided(pickup_end_time)) {
    return res.status(400).json({ error: "Title and pickup end time are required" });
  }

  if (!Number.isFinite(priceValue) || priceValue < 0 || priceValue > 100000) {
    return res.status(400).json({ error: "Invalid price" });
  }

  if (Number.isFinite(startTime) && startTime >= endTime) {
    return res.status(400).json({ error: "Start time must be before end time" });
  }

  if (!Number.isFinite(endTime) || endTime <= Date.now()) {
    return res.status(400).json({ error: "Pickup end time must be in the future" });
  }

  const result = await pool.query(
    `UPDATE food_listings
     SET title=$1,
         description=$2,
         price=$3,
         pickup_start_time=$4,
         pickup_end_time=$5
     WHERE id=$6
     RETURNING *`,
    [String(title).trim(), description, priceValue, pickup_start_time, pickup_end_time, id],
  );

  await publishListingUpdated(id, {
    action: "updated",
    listing: result.rows[0],
  });

  res.json(result.rows[0]);
};

// DELETE FOOD
exports.deleteFood = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Food id is required" });
  }

  const food = await pool.query("SELECT * FROM food_listings WHERE id=$1", [
    id,
  ]);

  if (food.rows.length === 0)
    return res.status(404).json({ error: "Not found" });

  if (food.rows[0].provider_id !== req.user.id)
    return res.status(403).json({ error: "Unauthorized" });

  const deleted = food.rows[0];
  await pool.query("DELETE FROM food_listings WHERE id=$1", [id]);

  await publishListingUpdated(id, {
    action: "deleted",
    listing: { ...deleted, status: "deleted" },
  });

  res.json({ message: "Deleted successfully" });
};

// GET ALL FOOD
exports.getAllFood = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const pageValue = toNumber(page);
  const limitValue = toNumber(limit);

  if (!isIntegerInRange(pageValue, 1, 10000) || !isIntegerInRange(limitValue, 1, 100)) {
    return res.status(400).json({ error: "Invalid pagination" });
  }

  const offset = (pageValue - 1) * limitValue;

  const result = await pool.query(
    `SELECT * FROM food_listings
   ORDER BY created_at DESC
   LIMIT $1 OFFSET $2`,
    [limitValue, offset],
  );

  res.json(result.rows);
};

// GET ACTIVE FOOD
exports.getActiveFood = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query;
  const hasLat = isProvided(lat);
  const hasLng = isProvided(lng);

  // 🔹 If no location → fallback
  if (!hasLat && !hasLng) {
    const result = await pool.query(
      `SELECT *
       FROM food_listings
       WHERE status = 'active'
       AND pickup_end_time > NOW()
       AND remaining_quantity > 0
       ORDER BY pickup_end_time ASC`
    );

    return res.json(result.rows);
  }

  if (hasLat !== hasLng) {
    return res.status(400).json({ error: "Latitude and longitude required" });
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const radiusValue = toNumber(radius);

  if (!isNumberInRange(radiusValue, 0.1, 100)) {
    return res.status(400).json({ error: "Radius must be between 0.1 and 100 km" });
  }

  // 🔥 GEO QUERY
  const result = await pool.query(
    `
    SELECT *,
    ST_Distance(
      location,
      ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
    ) AS distance
    FROM food_listings
    WHERE status = 'active'
    AND pickup_end_time > NOW()
    AND remaining_quantity > 0
    AND ST_DWithin(
      location,
      ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,
      $3 * 1000
    )
    ORDER BY distance ASC
    `,
    [toNumber(lat), toNumber(lng), radiusValue]
  );

  res.json(result.rows);
};

// GET FOOD BY ID
exports.getFoodById = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Food id is required" });
  }

  const result = await pool.query("SELECT * FROM food_listings WHERE id=$1", [
    id,
  ]);

  if (result.rows.length === 0)
    return res.status(404).json({ error: "Not found" });

  res.json(result.rows[0]);
};

// GET NEARBY FOOD (basic radius search)
exports.getNearbyFood = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query;

  if (!isProvided(lat) || !isProvided(lng)) {
    return res.status(400).json({ error: "Latitude and longitude required" });
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const radiusValue = toNumber(radius);

  if (!isNumberInRange(radiusValue, 0.1, 100)) {
    return res.status(400).json({ error: "Radius must be between 0.1 and 100 km" });
  }

  const result = await pool.query(
    `
    SELECT id, title, remaining_quantity
    FROM food_listings
    WHERE status='active'
    AND ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,
        $3*1000
    )
    ORDER BY ST_Distance(
        location,
        ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
    );
    `,
    [toNumber(lat), toNumber(lng), radiusValue],
  );

  res.json(result.rows);
};

// 🔍 View NGOs
exports.viewNGOs = async (req, res) => {
  const result = await pool.query(`
    SELECT id, organization_name, urgent_flag
    FROM ngos
    ORDER BY urgent_flag DESC
  `);

  res.json(result.rows);
};

exports.requestNGO = async (req, res) => {
  if (req.user.role !== "provider")
    return res.status(403).json({ error: "Access denied" });

  const listingId = req.params.id;
  const { ngo_id } = req.body;

  if (!isValidId(listingId)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  if (!isValidId(ngo_id)) {
    return res.status(400).json({ error: "NGO id is required" });
  }

  // 1️⃣ Validate listing
  const listing = await pool.query(
    `
    SELECT f.*, u.name AS provider_name
    FROM food_listings f
    JOIN users u ON u.id=f.provider_id
    WHERE f.id=$1 AND f.provider_id=$2
    `,
    [listingId, req.user.id]
  );

  if (!listing.rows.length)
    return res.status(404).json({ error: "Listing not found" });

  const food = listing.rows[0];

  // ⏱ Time check
  const endTime = new Date(food.pickup_end_time).getTime();
  if (endTime - Date.now() < 30 * 60 * 1000) {
    return res.status(400).json({
      error: "Cannot request NGO: less than 30 minutes remaining",
    });
  }

  // 🔥 Get NGO user
  const ngoUser = await pool.query(
    `SELECT user_id FROM ngos WHERE id=$1`,
    [ngo_id]
  );

  if (!ngoUser.rows.length)
    return res.status(404).json({ error: "NGO not found" });

  const ngoUserId = ngoUser.rows[0].user_id;

  // 🚨 2️⃣ Already owns listing?
  const existingReservation = await pool.query(
    `
    SELECT id
    FROM reservations
    WHERE listing_id=$1
    AND user_id=$2
    AND pickup_type='ngo'
    AND status IN ('reserved', 'picked_up')
    `,
    [listingId, ngoUserId]
  );

  if (existingReservation.rows.length) {
    return res.status(409).json({
      error: "NGO already owns this food. Request another listing.",
    });
  }

  // 🚨 3️⃣ Duplicate request?
  const existingRequest = await pool.query(
    `
    SELECT id
    FROM ngo_requests
    WHERE listing_id=$1
    AND ngo_id=$2
    AND status='pending'
    `,
    [listingId, ngo_id]
  );

  if (existingRequest.rows.length) {
    return res.status(409).json({
      error: "Request already sent to this NGO",
    });
  }

  // ✅ 4️⃣ Insert request
  await pool.query(
    `
    INSERT INTO ngo_requests (listing_id, ngo_id, status)
    VALUES ($1,$2,'pending')
    `,
    [listingId, ngo_id]
  );

  // 🔔 Notify NGO
  await notificationQueue.add("notify-user", {
    userId: ngoUserId,
    type: "ngo_request_received",
    title: "New Food Rescue Request",
    message: `${food.provider_name} requested your NGO to collect food: ${food.title}`,
  });

  const io = req.app.get("io");
  io?.to(`user:${ngoUserId}`).emit("ngo:request_received", {
    listing_id: listingId,
  });

  res.json({ message: "NGO request sent successfully" });
};
