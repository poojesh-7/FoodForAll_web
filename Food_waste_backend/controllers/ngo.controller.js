const pool = require("../shared/config/db");
const generatePickupCode = require("../utils/codeGenerator");
const { addNGOLocation } = require("../services/geo.service");
const notificationQueue = require("../queues/notification.queue");
const {
  publishListingUpdated,
  publishReservationUpdated,
} = require("../shared/services/realtime.service");
const {
  isProvided,
  isValidId,
  isValidLatitude,
  isValidLongitude,
  toNumber,
} = require("../utils/validation");

const RESERVATION_EXISTS_MESSAGE = "You have already interacted with this listing.";

function withStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function uniqueListingIds(reservations) {
  return [
    ...new Set(
      reservations
        .map((reservation) => reservation.listing_id)
        .filter((listingId) => listingId !== undefined && listingId !== null)
    ),
  ];
}

async function ensureListingNotPreviouslyReserved(client, userId, listingId) {
  const existingReservation = await client.query(
    `
    SELECT id
    FROM reservations
    WHERE user_id=$1
    AND listing_id=$2
    LIMIT 1
    `,
    [userId, listingId]
  );

  if (existingReservation.rows.length) {
    throw withStatus(RESERVATION_EXISTS_MESSAGE, 409);
  }
}

exports.registerNGO = async (req, res) => {
  try {
    const userId = req.user.id;

    // 🔹 Role check
    if (req.user.role !== "ngo") {
      return res.status(403).json({
        error: "Only NGO users can register",
      });
    }

    const {
      organization_name,
      registration_number,
      service_radius_km,
      latitude,
      longitude,
    } = req.body;

    // 🔹 Validation
    if (!isProvided(organization_name) || !isProvided(registration_number)) {
      return res.status(400).json({
        error: "Organization name and registration number are required",
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
      : 10;

    if (!Number.isFinite(serviceRadius) || serviceRadius <= 0) {
      return res.status(400).json({
        error: "Service radius must be positive",
      });
    }

    const normalizedName = String(organization_name).trim();
    const normalizedReg = String(registration_number).trim();

    // 🔹 Check if NGO already registered for this user
    const existingNGO = await pool.query(
      "SELECT id, rejection_reason FROM ngos WHERE user_id=$1",
      [userId]
    );

    const existing = existingNGO.rows[0];

    if (existing && !existing.rejection_reason) {
      return res.status(409).json({
        error: "NGO already registered for this user",
      });
    }

    // 🔹 Insert NGO
    const result = existing
      ? await pool.query(
          `
          UPDATE ngos
          SET organization_name=$1,
              registration_number=$2,
              service_radius_km=$3,
              latitude=$4,
              longitude=$5,
              location=ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,
              is_verified=false,
              rejection_reason=NULL
          WHERE id=$6
          RETURNING
            id,
            user_id,
            organization_name,
            service_radius_km,
            is_verified,
            rejection_reason,
            'pending' AS verification_status
          `,
          [
            normalizedName,
            normalizedReg,
            serviceRadius,
            latitudeValue,
            longitudeValue,
            existing.id,
          ]
        )
      : await pool.query(
          `
          INSERT INTO ngos (
            user_id,
            organization_name,
            registration_number,
            service_radius_km,
            latitude,
            longitude,
            location,
            is_verified
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,
            ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,
            false
          )
          RETURNING
            id,
            user_id,
            organization_name,
            service_radius_km,
            is_verified,
            rejection_reason,
            'pending' AS verification_status
          `,
          [
            userId,
            normalizedName,
            normalizedReg,
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

    const ngo = result.rows[0];

    // 🔹 Optional: handle location sync safely
    try {
      await addNGOLocation(ngo.id, longitudeValue, latitudeValue);
    } catch (locErr) {
      console.error("Location sync failed:", locErr);
      // Don't fail main request
    }

    res.status(existing ? 200 : 201).json({
      message: existing
        ? "NGO verification resubmitted successfully"
        : "NGO registered successfully",
      ngo,
    });

  } catch (err) {
    console.error(err);

    // 🔹 Duplicate handling
    if (err.code === "23505") {
      return res.status(409).json({
        error: "NGO already exists (duplicate entry)",
      });
    }

    res.status(500).json({
      error: "NGO registration failed",
    });
  }
};

exports.getMyNGO = async (req, res) => {
  const result = await pool.query("SELECT * FROM ngos WHERE user_id=$1", [
    req.user.id,
  ]);

  if (!result.rows.length)
    return res.status(404).json({ error: "NGO profile not found" });

  res.json(result.rows[0]);
};

exports.getNearbyListings = async (req, res) => {
  const ngo = await pool.query(
    "SELECT service_radius_km FROM ngos WHERE user_id=$1",
    [req.user.id],
  );

  if (!ngo.rows.length)
    return res.status(404).json({ error: "NGO not registered" });

  const radius = ngo.rows[0].service_radius_km;

  const { lat, lng } = req.query;

  if (!isProvided(lat) || !isProvided(lng)) {
    return res.status(400).json({ error: "Latitude and longitude required" });
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const result = await pool.query(
    `
    SELECT id, title, remaining_quantity
    FROM food_listings
    WHERE status='active'
    AND is_free = true
    AND remaining_quantity > 0
    AND ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
        $3
    )
    ORDER BY ST_Distance(
        location,
        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography
    );
    `,
    [toNumber(lng), toNumber(lat), radius * 1000],
  );

  res.json(result.rows);
};


exports.bulkReserve = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Only NGOs allowed" });
  const { reservations } = req.body;

  if (!Array.isArray(reservations) || reservations.length === 0) {
    return res.status(400).json({ error: "Reservations are required" });
  }

  for (const item of reservations) {
    if (!isValidId(item?.listing_id)) {
      return res.status(400).json({ error: "Listing id is required" });
    }

    const quantity = toNumber(item?.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "Valid quantity is required" });
    }
  }
  
  const NGO_MAX_LIMIT = 40; // or 50 based on your decision

  const totalQuantity = reservations.reduce(
    (sum, item) => sum + toNumber(item.quantity),
    0
  );
  
  if (totalQuantity > NGO_MAX_LIMIT) {
    return res.status(400).json({
      error: `NGO cannot reserve more than ${NGO_MAX_LIMIT} items at once`,
    });
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const created = [];
    for (const item of reservations) {
      const quantity = toNumber(item.quantity);
      const foodResult = await client.query(
        `SELECT * FROM food_listings WHERE id=$1 FOR UPDATE`,
        [item.listing_id]
      );

      const food = foodResult.rows[0];

      if (!food) {
        const error = new Error("Listing not found");
        error.statusCode = 404;
        throw error;
      }

      if (!food.is_free) {
        const error = new Error("NGOs can reserve only free listings");
        error.statusCode = 403;
        throw error;
      }

      await ensureListingNotPreviouslyReserved(
        client,
        req.user.id,
        item.listing_id
      );

      if (food.remaining_quantity < quantity) {
        const error = new Error("Not enough quantity");
        error.statusCode = 409;
        throw error;
      }

      const reservation = await client.query(
        `
        INSERT INTO reservations
        (listing_id, user_id, quantity_reserved, pickup_type, task_status, status, payment_status, pickup_code, receive_code)
        VALUES ($1,$2,$3,'ngo','pending','reserved','not_required',$4,$5)
        RETURNING *
        `,
        [
          item.listing_id,
          req.user.id,
          quantity,
          generatePickupCode(),
          generatePickupCode(),
        ]
      );

      const r = reservation.rows[0];
      created.push(r);

      const stockUpdate = await client.query(
        `
        UPDATE food_listings
        SET remaining_quantity = remaining_quantity - $1
        WHERE id=$2
        AND remaining_quantity >= $1
        RETURNING remaining_quantity
        `,
        [quantity, item.listing_id]
      );

      if (!stockUpdate.rows.length) {
        const error = new Error("Not enough quantity");
        error.statusCode = 409;
        throw error;
      }
    }

    await client.query("COMMIT");

    await Promise.all([
      ...created.map((reservation) =>
        publishReservationUpdated(reservation.id, { action: "created" })
      ),
      ...uniqueListingIds(created).map((listingId) =>
        publishListingUpdated(listingId, { action: "quantity_updated" })
      ),
    ]);

    res.json({
      reservations: created,
      payment: null,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    if (
      err.code === "23505" ||
      err.constraint === "unique_active_reservation"
    ) {
      return res.status(409).json({ error: RESERVATION_EXISTS_MESSAGE });
    }

    res.status(err.statusCode || 400).json({ error: err.message });
  } finally {
    client.release();
  }
};

// 👀 View volunteers
exports.viewVolunteers = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  const result = await pool.query(
    `
    SELECT u.id, u.name, v.status
    FROM volunteers v
    JOIN users u ON u.id=v.user_id
    WHERE v.ngo_id=$1 AND v.status='active'
    `,
    [req.user.id],
  );

  res.json(result.rows);
};

// 👤 View unassigned volunteers
exports.viewUnassignedVolunteers = async (req, res) => {
  const result = await pool.query(`
    SELECT u.id, u.name, u.is_available 
    FROM users u
    WHERE u.role='volunteer'
    AND NOT EXISTS (
      SELECT 1 FROM volunteers v
      WHERE v.user_id=u.id AND v.status='active'
    )
  `);

  res.json(result.rows);
};


exports.getMyReservations = async (req, res) => {
  try {
    if (req.user.role !== "ngo") {
      return res.status(403).json({
        error: "Only NGOs allowed",
      });
    }

    const result = await pool.query(
      `
      SELECT
        r.id,
        r.quantity_reserved,
        r.pickup_type,
        r.task_status,
        r.status,
        r.payment_status,
        r.pickup_code,
        r.receive_code,
        r.completed_at,
        r.reserved_at,

        f.id AS listing_id,
        f.title,
        f.description,
        f.pickup_start_time,
        f.pickup_end_time,
        f.is_free,
        f.price,

        u.id AS provider_id,
        u.name AS provider_name,
        u.phone AS provider_phone,

        rating.id AS review_id,
        rating.rating AS review_rating,
        rating.review AS review_text

      FROM reservations r
      JOIN food_listings f
        ON f.id = r.listing_id
      JOIN users u
        ON u.id = f.provider_id
      LEFT JOIN ratings rating
        ON rating.reservation_id = r.id

      WHERE r.user_id = $1
      ORDER BY r.reserved_at DESC;
      `,
      [req.user.id]
    );

    res.json({
      reservations: result.rows,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to fetch NGO reservations",
    });
  }
};

// 📩 Request volunteer
exports.requestVolunteer = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  const { volunteer_id } = req.body;

  if (!isValidId(volunteer_id)) {
    return res.status(400).json({ error: "Volunteer id is required" });
  }

  // 1️⃣ Get NGO table ID using user_id
  const ngo = await pool.query(
    `SELECT id,organization_name FROM ngos WHERE user_id=$1`,
    [req.user.id],
  );

  if (!ngo.rows.length) return res.status(404).json({ error: "NGO not found" });

  const ngoId = ngo.rows[0].id;

  // 2️⃣ Insert request
  await pool.query(
    `
    INSERT INTO volunteer_requests (ngo_id, volunteer_id)
    VALUES ($1,$2)
    `,
    [ngoId, volunteer_id],
  );

  // const volunteerResult = await pool.query(
  //   "SELECT id, name from users where id=$1",
  //   [volunteer_id],
  // );
  // const { id, name } = volunteerResult.rows[0];
  const organization_name = ngo.rows[0].organization_name;

  await notificationQueue.add("notify-user", {
    userId: volunteer_id,
    type: "volunteer_join_request",
    title: "NGO Sent Request",
    message: `${organization_name} has requested you to join the NGO`,
  });

  res.json({ message: "Volunteer request sent" });
};

// 🚨 Set urgent
exports.setUrgent = async (req, res) => {
  const { urgent_flag } = req.body;

  if (urgent_flag === undefined || urgent_flag === null) {
    return res.status(400).json({ error: "urgent_flag is required" });
  }

  const ngo = await pool.query(`SELECT id FROM ngos WHERE user_id=$1`, [
    req.user.id,
  ]);

  if (!ngo.rows.length) return res.status(404).json({ error: "NGO not found" });

  await pool.query(
    `
    UPDATE ngos
    SET urgent_flag=$1
    WHERE id=$2
    `,
    [urgent_flag, ngo.rows[0].id],
  );

  res.json({ message: "Urgency updated" });
};

exports.viewIncomingRequests = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  const ngo = await pool.query(`SELECT id FROM ngos WHERE user_id=$1`, [
    req.user.id,
  ]);

  if (!ngo.rows.length)
    return res.status(404).json({ error: "NGO profile not found" });

  const ngoId = ngo.rows[0].id;

  const result = await pool.query(
    `
    SELECT nr.id AS request_id,
           f.id AS listing_id,
           f.title,
           f.remaining_quantity,
           u.name AS provider_name
    FROM ngo_requests nr
    JOIN food_listings f ON f.id=nr.listing_id
    JOIN users u ON u.id=f.provider_id
    WHERE nr.ngo_id=$1
    AND nr.status='pending'
    ORDER BY nr.requested_at DESC
    `,
    [ngoId],
  );

  res.json(result.rows);
};

exports.acceptNGORequest = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  const requestId = req.params.requestID;

  if (!isValidId(requestId)) {
    return res.status(400).json({ error: "Request id is required" });
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ NGO
    const ngoResult = await client.query(
      `SELECT id, organization_name FROM ngos WHERE user_id=$1`,
      [req.user.id]
    );

    if (!ngoResult.rows.length) {
      const error = new Error("NGO profile not found");
      error.statusCode = 404;
      throw error;
    }

    const ngoId = ngoResult.rows[0].id;

    // 2️⃣ Get request
    const request = await client.query(
      `
      SELECT r.*, f.id AS listing_id, f.remaining_quantity, f.pickup_end_time, f.status
      FROM ngo_requests r
      JOIN food_listings f ON f.id = r.listing_id
      WHERE r.id=$1
      AND r.ngo_id=$2
      AND r.status='pending'
      FOR UPDATE
      `,
      [requestId, ngoId]
    );

    if (!request.rows.length) {
      const error = new Error("Request not found or already processed");
      error.statusCode = 409;
      throw error;
    }

    const row = request.rows[0];
    const listingId = row.listing_id;

    // 🔥 3️⃣ LOCK LISTING (CRITICAL)
    const listingLock = await client.query(
      `
      SELECT * FROM food_listings
      WHERE id=$1
      FOR UPDATE
      `,
      [listingId]
    );

    const listing = listingLock.rows[0];

    // 🚨 Prevent double accept
    if (listing.status !== "active") {
      const error = new Error("Listing already taken or expired");
      error.statusCode = 409;
      throw error;
    }

    if (!listing.is_free) {
      const error = new Error("NGOs can reserve only free listings");
      error.statusCode = 403;
      throw error;
    }

    // ⏱ Time check
    await ensureListingNotPreviouslyReserved(client, req.user.id, listingId);

    const endTime = new Date(listing.pickup_end_time).getTime();
    if (endTime - Date.now() < 30 * 60 * 1000) {
      const error = new Error("Insufficient pickup time remaining");
      error.statusCode = 400;
      throw error;
    }

    // 4️⃣ Accept THIS request
    await client.query(
      `
      UPDATE ngo_requests
      SET status='accepted', responded_at=NOW()
      WHERE id=$1
      `,
      [requestId]
    );

    // 🔥 5️⃣ EXPIRE OTHER REQUESTS (ONLY SAME LISTING)
    await client.query(
      `
      UPDATE ngo_requests
      SET status='expired', responded_at=NOW()
      WHERE listing_id=$1
      AND id != $2
      AND status='pending'
      `,
      [listingId, requestId]
    );

    // 6️⃣ Create reservation
    const pickupCode = generatePickupCode();
    const receiveCode = generatePickupCode();

    const reservationResult = await client.query(
      `
      INSERT INTO reservations
      (listing_id, user_id, quantity_reserved, pickup_type, task_status, status, payment_status, pickup_code, receive_code)
      VALUES ($1,$2,$3,'ngo','pending','reserved','not_required',$4,$5)
      RETURNING *
      `,
      [listingId, req.user.id, listing.remaining_quantity, pickupCode, receiveCode]
    );

    // 7️⃣ Mark listing completed
    await client.query(
      `
      UPDATE food_listings
      SET remaining_quantity=0,
          status='completed'
      WHERE id=$1
      `,
      [listingId]
    );

    await client.query("COMMIT");

    // 🔔 Notification AFTER commit
    const createdReservation = reservationResult.rows[0];

    await Promise.all([
      publishReservationUpdated(createdReservation.id, { action: "created" }),
      publishListingUpdated(listingId, { action: "completed" }),
    ]);

    await notificationQueue.add("notify-user", {
      userId: listing.provider_id,
      type: "ngo_request_accepted",
      title: "NGO Accepted Your Request",
      message: `${ngoResult.rows[0].organization_name} accepted your request`,
    });

    res.json({ message: "Request accepted successfully" });

  } catch (err) {
    await client.query("ROLLBACK");
    if (
      err.code === "23505" ||
      err.constraint === "unique_active_reservation"
    ) {
      return res.status(409).json({ error: RESERVATION_EXISTS_MESSAGE });
    }

    res.status(err.statusCode || 400).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.rejectRequest = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  const requestId = req.params.requestId || req.params.requestID;

  if (!isValidId(requestId)) {
    return res.status(400).json({ error: "Request id is required" });
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get NGO
    const ngoResult = await client.query(
      `SELECT id FROM ngos WHERE user_id=$1`,
      [req.user.id]
    );

    if (!ngoResult.rows.length) {
      const error = new Error("NGO profile not found");
      error.statusCode = 404;
      throw error;
    }

    const ngoId = ngoResult.rows[0].id;

    // 2️⃣ Get request
    const request = await client.query(
      `
      SELECT r.*, f.provider_id, f.title
      FROM ngo_requests r
      JOIN food_listings f ON f.id = r.listing_id
      WHERE r.id=$1 AND r.ngo_id=$2 AND r.status='pending'
      FOR UPDATE
      `,
      [requestId, ngoId]
    );

    if (!request.rows.length) {
      const error = new Error("Request not found");
      error.statusCode = 404;
      throw error;
    }

    const { provider_id, title } = request.rows[0];

    // 3️⃣ Update request
    await client.query(
      `
      UPDATE ngo_requests
      SET status='rejected',
          responded_at=NOW()
      WHERE id=$1
      `,
      [requestId]
    );

    await client.query("COMMIT");

    // 🔔 Notify provider
    await notificationQueue.add("notify-user", {
      userId: provider_id,
      type: "ngo_request_rejected",
      title: "NGO Rejected Your Request",
      message: `Your request for ${title} was rejected by the NGO`,
    });

    res.json({ message: "Request rejected" });

  } catch (err) {
    await client.query("ROLLBACK");

    res.status(err.statusCode || 400).json({
      error: err.message,
    });
  } finally {
    client.release();
  }
};
