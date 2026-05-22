const pool = require("../shared/config/db");
const generatePickupCode = require("../utils/codeGenerator");
const { addNGOLocation } = require("../services/geo.service");
const notificationQueue = require("../queues/notification.queue");
const {
  publishListingUpdated,
  publishPaymentUpdated,
  publishToUsers,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
} = require("../shared/services/realtime.service");
const { createReservationPayment } = require("../shared/services/payment.service");
const { getReservationPolicy } = require("../shared/services/restriction.service");
const { reserveListingStock } = require("../shared/services/inventory.service");
const { providerDisplaySelect } = require("../shared/services/providerDisplay.service");
const {
  blockingReservationWhere,
  pendingPaymentReservationWhere,
} = require("../shared/services/reservationLock.service");
const {
  ensureReservationPaymentContextSchema,
} = require("../shared/services/reservationPaymentContext.service");
const {
  ensureVolunteerRequestSchema,
} = require("../shared/services/volunteerRequestSchema.service");
const logger = require("../shared/utils/logger");
const {
  isIntegerInRange,
  isNumberInRange,
  isProvided,
  isValidId,
  isValidLatitude,
  isValidLongitude,
  parseBoolean,
  toNumber,
} = require("../utils/validation");

const RESERVATION_EXISTS_MESSAGE = "User already has reservation for this listing.";

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
    AND (
      ${blockingReservationWhere()}
      OR ${pendingPaymentReservationWhere()}
      OR (
        status='cancelled'
        AND COALESCE(payment_status, '') IN (
          'paid',
          'not_required',
          'refund_pending',
          'refunded',
          'refund_failed'
        )
      )
    )
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

    if (!["user", "volunteer", "ngo"].includes(user.role)) {
      logger.security("Blocked NGO onboarding application", {
        reason: "ineligible_current_role",
        userId,
        role: user.role,
      });

      return res.status(403).json({
        error: "This account cannot apply for NGO verification",
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

    if (!isNumberInRange(serviceRadius, 1, 100)) {
      return res.status(400).json({
        error: "Service radius must be between 1 and 100 km",
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
        role = 'ngo',
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
      logger.warn("NGO location sync failed", {
        err: locErr,
        userId: req.user?.id,
      });
      // Don't fail main request
    }

    res.status(existing ? 200 : 201).json({
      message: existing
        ? "NGO verification resubmitted successfully"
        : "NGO registered successfully",
      ngo,
    });

  } catch (err) {
    logger.error("NGO registration failed", {
      err,
      userId: req.user?.id,
    });

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
  const result = await pool.query(
    `
    SELECT
      n.*,
      u.reliability_deposit_amount,
      u.reliability_deposit_amount AS refundable_deposit,
      u.requires_reliability_deposit,
      u.restriction_level,
      u.restriction_reason,
      u.restriction_type,
      u.cooldown_until,
      u.banned_until,
      u.trust_score
    FROM ngos n
    JOIN users u
      ON u.id = n.user_id
    WHERE n.user_id=$1
    `,
    [req.user.id]
  );

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
    SELECT
      f.id,
      f.title,
      f.description,
      f.remaining_quantity,
      f.pickup_end_time,
      f.status,
      f.is_free,
      ${providerDisplaySelect("restaurant", "u")} AS provider_name,
      restaurant.restaurant_name
    FROM food_listings f
    JOIN users u ON u.id=f.provider_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id=f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    WHERE f.status='active'
    AND f.is_free = true
    AND f.remaining_quantity > 0
    AND EXISTS (
      SELECT 1
      FROM restaurants approved_restaurant
      WHERE approved_restaurant.user_id=f.provider_id
      AND approved_restaurant.is_verified=true
    )
    AND ST_DWithin(
        f.location,
        ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
        $3
    )
    ORDER BY ST_Distance(
        f.location,
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

    if (!isIntegerInRange(quantity, 1, 40)) {
      return res.status(400).json({ error: "Quantity must be an integer between 1 and 40" });
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
    await ensureReservationPaymentContextSchema(client);
    const policy = await getReservationPolicy({
      client,
      userId: req.user.id,
      role: "ngo",
    });

    if (!policy.canReserve) {
      throw withStatus(policy.restrictionReason || "NGO reservation restricted", 403);
    }

    const created = [];
    const providerNotifications = [];
    const paymentReservations = [];
    for (const item of reservations) {
      const quantity = toNumber(item.quantity);
      const foodResult = await client.query(
        `
        SELECT f.*
        FROM food_listings f
        WHERE f.id=$1
        AND EXISTS (
          SELECT 1
          FROM restaurants approved_restaurant
          WHERE approved_restaurant.user_id=f.provider_id
          AND approved_restaurant.is_verified=true
        )
        FOR UPDATE
        `,
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

      if (String(food.status || "active") !== "active") {
        throw withStatus("Listing is not active", 409);
      }

      if (new Date(food.pickup_end_time).getTime() <= Date.now()) {
        throw withStatus("Listing pickup window has ended", 409);
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

      await reserveListingStock(client, {
        listingId: item.listing_id,
        quantity,
      });
      logger.info("Inventory reserved for NGO reservation", {
        userId: req.user.id,
        listingId: item.listing_id,
        quantity,
        requiresPayment: Boolean(policy.requiresDeposit),
      });

      const reservation = await client.query(
        `
        INSERT INTO reservations
        (listing_id, user_id, quantity_reserved, pickup_type, task_status, status, payment_status, pickup_code, receive_code, payment_context)
        VALUES ($1,$2,$3,'ngo','pending',$6,$7,$4,$5,$8::jsonb)
        RETURNING *
        `,
        [
          item.listing_id,
          req.user.id,
          quantity,
          policy.requiresDeposit ? null : generatePickupCode(),
          policy.requiresDeposit ? null : generatePickupCode(),
          policy.requiresDeposit ? "payment_pending" : "reserved",
          policy.requiresDeposit ? "pending" : "not_required",
          JSON.stringify({
            source: "ngo_bulk_reserve",
            stock_reserved: true,
          }),
        ]
      );

      const r = reservation.rows[0];
      created.push(r);
      paymentReservations.push({
        ...r,
        food_amount: 0,
        reliability_deposit_amount: policy.requiresDeposit ? policy.depositAmount : 0,
      });
      providerNotifications.push({
        providerId: food.provider_id,
        reservationId: r.id,
        listingId: r.listing_id,
      });

    }

    const payment = policy.requiresDeposit
      ? await createReservationPayment({
          client,
          user: req.user,
          reservations: paymentReservations,
        })
      : null;

    await client.query("COMMIT");

    await Promise.all([
      ...created.map((reservation) =>
        policy.requiresDeposit
          ? Promise.resolve()
          : publishReservationUpdated(reservation.id, { action: "created" })
      ),
      ...created.map((reservation) =>
        policy.requiresDeposit
          ? Promise.resolve()
          : publishTaskAvailabilityUpdated(reservation.id, { action: "available" })
      ),
      ...uniqueListingIds(created).map((listingId) =>
        publishListingUpdated(listingId, { action: "quantity_updated" })
      ),
      ...(policy.requiresDeposit
        ? []
        : providerNotifications.map((notification) =>
            notificationQueue
              .add("notify-user", {
                userId: notification.providerId,
                type: "reservation_created",
                title: "New NGO Reservation",
                message: "An NGO reserved food for pickup.",
                data: {
                  reservation_id: notification.reservationId,
                  listing_id: notification.listingId,
                },
              })
              .catch((err) => {
                logger.warn("Provider NGO reservation notification failed", {
                  err,
                  reservationId: notification.reservationId,
                  providerId: notification.providerId,
                });
              })
          )),
    ]).catch((err) => {
      logger.warn("NGO bulk reservation side effects failed", {
        err,
        userId: req.user?.id,
        reservationIds: created.map((reservation) => reservation.id),
      });
    });

    res.json({
      reservations: created,
      payment,
      pricing: {
        foodAmount: 0,
        depositAmount: policy.requiresDeposit ? Number(policy.depositAmount || 0) : 0,
        totalAmount: policy.requiresDeposit ? Number(policy.depositAmount || 0) : 0,
        requiresDeposit: Boolean(policy.requiresDeposit),
        totalQuantity,
      },
      policy,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    if (
      err.code === "23505" ||
      err.constraint === "unique_active_reservation" ||
      err.constraint === "unique_pending_payment_reservation"
    ) {
      return res.status(409).json({ error: RESERVATION_EXISTS_MESSAGE });
    }

    logger.warn("NGO bulk reservation failed", {
      err,
      userId: req.user?.id,
      reason: err.reason,
      reservationCount: Array.isArray(reservations) ? reservations.length : 0,
    });

    res.status(err.statusCode || 400).json({ error: err.message });
  } finally {
    client.release();
  }
};

// 👀 View volunteers
exports.viewVolunteers = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  const ngo = await pool.query(`SELECT id FROM ngos WHERE user_id=$1`, [
    req.user.id,
  ]);

  if (!ngo.rows.length)
    return res.status(404).json({ error: "NGO profile not found" });

  const result = await pool.query(
    `
    SELECT u.id, u.name, u.phone, u.is_available, v.status
    FROM volunteers v
    JOIN users u ON u.id=v.user_id
    WHERE v.ngo_id=$1 AND v.status='active'
    `,
    [ngo.rows[0].id],
  );

  res.json(result.rows);
};

exports.previewBulkReserve = async (req, res) => {
  if (req.user.role !== "ngo") {
    return res.status(403).json({ error: "Only NGOs allowed" });
  }

  const { reservations } = req.body;

  if (!Array.isArray(reservations) || reservations.length === 0) {
    return res.status(400).json({ error: "Reservations are required" });
  }

  let totalQuantity = 0;

  for (const item of reservations) {
    if (!isValidId(item?.listing_id)) {
      return res.status(400).json({ error: "Listing id is required" });
    }

    const quantity = toNumber(item?.quantity);

    if (!isIntegerInRange(quantity, 1, 40)) {
      return res.status(400).json({ error: "Quantity must be an integer between 1 and 40" });
    }

    totalQuantity += quantity;
  }

  if (totalQuantity > 40) {
    return res.status(400).json({
      error: "NGO cannot reserve more than 40 items at once",
    });
  }

  try {
    const policy = await getReservationPolicy({
      userId: req.user.id,
      role: "ngo",
    });

    if (!policy.canReserve) {
      return res.status(403).json({
        error: policy.restrictionReason || "NGO reservation restricted",
      });
    }

    for (const item of reservations) {
      const quantity = toNumber(item.quantity);
      const foodResult = await pool.query(
        `
        SELECT f.id, f.is_free, f.remaining_quantity, f.status, f.pickup_end_time
        FROM food_listings f
        WHERE f.id=$1
        AND EXISTS (
          SELECT 1
          FROM restaurants approved_restaurant
          WHERE approved_restaurant.user_id=f.provider_id
          AND approved_restaurant.is_verified=true
        )
        `,
        [item.listing_id]
      );

      const food = foodResult.rows[0];

      if (!food) {
        return res.status(404).json({ error: "Listing not found" });
      }

      if (!food.is_free) {
        return res.status(403).json({ error: "NGOs can reserve only free listings" });
      }

      if (String(food.status || "active") !== "active") {
        return res.status(409).json({ error: "Listing is not active" });
      }

      if (new Date(food.pickup_end_time).getTime() <= Date.now()) {
        return res.status(409).json({ error: "Listing pickup window has ended" });
      }

      if (toNumber(food.remaining_quantity) < quantity) {
        return res.status(409).json({ error: "Not enough quantity" });
      }
    }

    const depositAmount = policy.requiresDeposit ? Number(policy.depositAmount || 0) : 0;

    res.json({
      foodAmount: 0,
      depositAmount,
      totalAmount: depositAmount,
      requiresDeposit: depositAmount > 0,
      totalQuantity,
      policy: {
        ...policy,
        depositAmount,
        requiresDeposit: depositAmount > 0,
      },
    });
  } catch (err) {
    logger.error("NGO bulk reservation preview failed", { err, userId: req.user?.id });
    res.status(500).json({ error: "Reservation preview failed" });
  }
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
        r.payment_expires_at,
        r.assigned_volunteer_id,
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
        p.food_amount,
        p.reliability_deposit_amount,
        p.reliability_deposit_amount AS refundable_deposit,
        p.reliability_deposit_status,
        p.reliability_deposit_status AS deposit_status,
        p.refund_status,
        CASE
          WHEN r.status='payment_pending'
          AND r.payment_status='pending'
          AND p.status='pending'
          THEN p.order_id
          ELSE NULL
        END AS order_id,
        CASE
          WHEN r.status='payment_pending'
          AND r.payment_status='pending'
          AND p.status='pending'
          THEN p.payment_session_id
          ELSE NULL
        END AS payment_session_id,

        u.id AS provider_id,
        ${providerDisplaySelect("restaurant", "u")} AS provider_name,
        restaurant.restaurant_name,
        u.phone AS provider_phone,
        u.address AS provider_address,
        f.latitude AS provider_latitude,
        f.longitude AS provider_longitude,

        volunteer.name AS assigned_volunteer_name,
        volunteer.phone AS assigned_volunteer_phone,

        rating.id AS review_id,
        rating.rating AS review_rating,
        rating.review AS review_text

      FROM reservations r
      JOIN food_listings f
        ON f.id = r.listing_id
      JOIN users u
        ON u.id = f.provider_id
      LEFT JOIN LATERAL (
        SELECT restaurant_name,
               NULL::text AS business_name
        FROM restaurants
        WHERE user_id=f.provider_id
        ORDER BY is_verified DESC, id DESC
        LIMIT 1
      ) restaurant ON true
      LEFT JOIN users volunteer
        ON volunteer.id = r.assigned_volunteer_id
      LEFT JOIN ratings rating
        ON rating.reservation_id = r.id
      LEFT JOIN payments p
        ON p.reservation_id = r.id

      WHERE r.user_id = $1
      ORDER BY r.reserved_at DESC;
      `,
      [req.user.id]
    );

    res.json({
      reservations: result.rows,
    });

  } catch (err) {
    logger.error("Failed to fetch NGO reservations", {
      err,
      userId: req.user?.id,
    });

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

  await ensureVolunteerRequestSchema();

  const volunteerUser = await pool.query(
    `
    SELECT id
    FROM users
    WHERE id=$1
    AND role='volunteer'
    AND (banned_until IS NULL OR banned_until <= NOW())
    `,
    [volunteer_id],
  );

  if (!volunteerUser.rows.length) {
    logger.security("Blocked NGO invite to ineligible volunteer", {
      ngoUserId: req.user?.id,
      volunteerId: volunteer_id,
    });
    return res.status(403).json({ error: "Verified volunteer not found" });
  }

  // 1️⃣ Get NGO table ID using user_id
  const ngo = await pool.query(
    `SELECT id,organization_name FROM ngos WHERE user_id=$1`,
    [req.user.id],
  );

  if (!ngo.rows.length) return res.status(404).json({ error: "NGO not found" });

  const ngoId = ngo.rows[0].id;

  const active = await pool.query(
    `
    SELECT id
    FROM volunteers
    WHERE user_id=$1
    AND ngo_id=$2
    AND status='active'
    LIMIT 1
    `,
    [volunteer_id, ngoId],
  );

  if (active.rows.length)
    return res.status(409).json({ error: "Volunteer already active" });

  const pending = await pool.query(
    `
    SELECT id
    FROM volunteer_requests
    WHERE ngo_id=$1
    AND volunteer_id=$2
    AND request_type='ngo_invite'
    AND status='pending'
    LIMIT 1
    `,
    [ngoId, volunteer_id],
  );

  if (pending.rows.length)
    return res.status(409).json({ error: "Volunteer request already pending" });

  // 2️⃣ Insert request
  await pool.query(
    `
    INSERT INTO volunteer_requests (ngo_id, volunteer_id, request_type, status)
    VALUES ($1,$2,'ngo_invite','pending')
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
exports.viewVolunteerJoinRequests = async (req, res) => {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  await ensureVolunteerRequestSchema();

  const ngo = await pool.query(`SELECT id FROM ngos WHERE user_id=$1`, [
    req.user.id,
  ]);

  if (!ngo.rows.length)
    return res.status(404).json({ error: "NGO profile not found" });

  const result = await pool.query(
    `
    SELECT vr.id AS request_id,
           vr.ngo_id,
           vr.volunteer_id,
           vr.status,
           vr.requested_at,
           u.name AS volunteer_name,
           u.phone AS volunteer_phone,
           u.email AS volunteer_email,
           u.is_available
    FROM volunteer_requests vr
    JOIN users u ON u.id=vr.volunteer_id
    WHERE vr.ngo_id=$1
    AND vr.request_type='volunteer_join'
    AND vr.status='pending'
    ORDER BY vr.requested_at DESC NULLS LAST, vr.id DESC
    `,
    [ngo.rows[0].id],
  );

  res.json(result.rows);
};

async function handleVolunteerJoinRequest(req, res, action) {
  if (req.user.role !== "ngo")
    return res.status(403).json({ error: "Access denied" });

  const requestId = req.params.requestID;

  if (!isValidId(requestId)) {
    return res.status(400).json({ error: "Request id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureVolunteerRequestSchema(client);

    const ngoResult = await client.query(
      `SELECT id, organization_name FROM ngos WHERE user_id=$1`,
      [req.user.id],
    );

    if (!ngoResult.rows.length) throw withStatus("NGO profile not found", 404);

    const ngo = ngoResult.rows[0];

    const request = await client.query(
      `
      SELECT vr.*, u.name AS volunteer_name
      FROM volunteer_requests vr
      JOIN users u ON u.id=vr.volunteer_id
      WHERE vr.id=$1
      AND vr.ngo_id=$2
      AND vr.request_type='volunteer_join'
      AND vr.status='pending'
      FOR UPDATE
      `,
      [requestId, ngo.id],
    );

    if (!request.rows.length)
      throw withStatus("Request not found or already processed", 409);

    const row = request.rows[0];
    const nextStatus = action === "approve" ? "approved" : "rejected";

    if (action === "approve") {
      const otherActive = await client.query(
        `
        SELECT id
        FROM volunteers
        WHERE user_id=$1
        AND ngo_id<>$2
        AND status='active'
        LIMIT 1
        `,
        [row.volunteer_id, ngo.id],
      );

      if (otherActive.rows.length)
        throw withStatus("Volunteer is already active in another NGO", 409);

      await client.query(
        `
        INSERT INTO volunteers (user_id, ngo_id, status)
        VALUES ($1,$2,'active')
        ON CONFLICT (user_id, ngo_id)
        DO UPDATE SET status='active'
        `,
        [row.volunteer_id, ngo.id],
      );
    }

    await client.query(
      `
      UPDATE volunteer_requests
      SET status=$1,
          responded_at=NOW()
      WHERE id=$2
      `,
      [nextStatus, requestId],
    );

    if (action === "approve") {
      await client.query(
        `
        UPDATE volunteer_requests
        SET status='rejected',
            responded_at=NOW()
        WHERE volunteer_id=$1
        AND id<>$2
        AND request_type='volunteer_join'
        AND status='pending'
        `,
        [row.volunteer_id, requestId],
      );
    }

    await client.query("COMMIT");

    await notificationQueue.add("notify-user", {
      userId: row.volunteer_id,
      type:
        action === "approve"
          ? "volunteer_join_approved"
          : "volunteer_join_rejected",
      title:
        action === "approve"
          ? "Join Request Approved"
          : "Join Request Rejected",
      message:
        action === "approve"
          ? `${ngo.organization_name} approved your join request`
          : `${ngo.organization_name} rejected your join request`,
    });

    await publishToUsers([row.volunteer_id, req.user.id], "volunteer_updated", {
      action:
        action === "approve" ? "join_request_approved" : "join_request_rejected",
      volunteer: {
        id: row.volunteer_id,
        ngo_id: ngo.id,
        status: nextStatus,
        request_id: row.id,
      },
    });

    res.json({
      message:
        action === "approve"
          ? "Volunteer request approved"
          : "Volunteer request rejected",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(err.statusCode || 400).json({ error: err.message });
  } finally {
    client.release();
  }
}

exports.approveVolunteerJoinRequest = (req, res) =>
  handleVolunteerJoinRequest(req, res, "approve");

exports.rejectVolunteerJoinRequest = (req, res) =>
  handleVolunteerJoinRequest(req, res, "reject");

exports.setUrgent = async (req, res) => {
  const { urgent_flag } = req.body;
  const urgentFlag = parseBoolean(urgent_flag);

  if (urgentFlag === null) {
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
    [urgentFlag, ngo.rows[0].id],
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
           f.pickup_end_time,
           nr.requested_at,
           provider.id AS provider_id,
           ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
           provider.phone AS provider_phone,
           provider.trust_score,
           provider.restriction_level
    FROM ngo_requests nr
    JOIN food_listings f ON f.id=nr.listing_id
    JOIN users provider ON provider.id=f.provider_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id=f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
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
    await ensureReservationPaymentContextSchema(client);

    const policy = await getReservationPolicy({
      client,
      userId: req.user.id,
      role: "ngo",
    });

    if (!policy.canReserve) {
      throw withStatus(policy.restrictionReason || "NGO reservation restricted", 403);
    }

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
      AND EXISTS (
        SELECT 1
        FROM restaurants approved_restaurant
        WHERE approved_restaurant.user_id=food_listings.provider_id
        AND approved_restaurant.is_verified=true
      )
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
    if (!policy.requiresDeposit) {
      await client.query(
        `
        UPDATE ngo_requests
        SET status='accepted', responded_at=NOW()
        WHERE id=$1
        `,
        [requestId]
      );
    }

    // 🔥 5️⃣ EXPIRE OTHER REQUESTS (ONLY SAME LISTING)
    if (!policy.requiresDeposit) {
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
    }

    // 6️⃣ Create reservation
    const quantityToReserve = Number(listing.remaining_quantity);
    if (!Number.isInteger(quantityToReserve) || quantityToReserve <= 0) {
      throw withStatus("Listing has no remaining quantity", 409);
    }

    await reserveListingStock(client, {
      listingId,
      quantity: quantityToReserve,
    });
    logger.info("Inventory reserved for NGO request acceptance", {
      userId: req.user.id,
      listingId,
      requestId,
      quantity: quantityToReserve,
      requiresPayment: Boolean(policy.requiresDeposit),
    });

    const pickupCode = generatePickupCode();
    const receiveCode = generatePickupCode();

    const reservationResult = await client.query(
      `
      INSERT INTO reservations
      (listing_id, user_id, quantity_reserved, pickup_type, task_status, status, payment_status, pickup_code, receive_code, payment_context)
      VALUES ($1,$2,$3,'ngo','pending',$6,$7,$4,$5,$8::jsonb)
      RETURNING *
      `,
      [
        listingId,
        req.user.id,
        quantityToReserve,
        policy.requiresDeposit ? null : pickupCode,
        policy.requiresDeposit ? null : receiveCode,
        policy.requiresDeposit ? "payment_pending" : "reserved",
        policy.requiresDeposit ? "pending" : "not_required",
        JSON.stringify({
          source: "ngo_request_accept",
          request_id: requestId,
          ngo_id: ngoId,
          organization_name: ngoResult.rows[0].organization_name,
          provider_id: listing.provider_id,
          stock_reserved: true,
        }),
      ]
    );

    const createdReservation = reservationResult.rows[0];
    const payment = policy.requiresDeposit
      ? await createReservationPayment({
          client,
          user: req.user,
          reservations: [
            {
              ...createdReservation,
              food_amount: 0,
              reliability_deposit_amount: policy.depositAmount,
            },
          ],
        })
      : null;

    // 7️⃣ Mark listing completed
    await client.query("COMMIT");

    // 🔔 Notification AFTER commit
    await Promise.all([
      policy.requiresDeposit
        ? Promise.resolve()
        : publishReservationUpdated(createdReservation.id, { action: "created" }),
      policy.requiresDeposit
        ? Promise.resolve()
        : publishTaskAvailabilityUpdated(createdReservation.id, { action: "available" }),
      publishListingUpdated(listingId, { action: "completed" }),
    ]).catch((err) => {
      logger.warn("NGO request acceptance side effects failed", {
        err,
        userId: req.user?.id,
        requestId,
        reservationId: createdReservation.id,
      });
    });

    if (!policy.requiresDeposit) {
      await notificationQueue.add("notify-user", {
        userId: listing.provider_id,
        type: "ngo_request_accepted",
        title: "NGO Accepted Your Request",
        message: `${ngoResult.rows[0].organization_name} accepted your request`,
      });
    }

    res.json({ message: "Request accepted successfully", reservation: createdReservation, payment, policy });

  } catch (err) {
    await client.query("ROLLBACK");
    if (
      err.code === "23505" ||
      err.constraint === "unique_active_reservation" ||
      err.constraint === "unique_pending_payment_reservation"
    ) {
      return res.status(409).json({ error: RESERVATION_EXISTS_MESSAGE });
    }

    logger.warn("NGO request acceptance failed", {
      err,
      userId: req.user?.id,
      requestId,
      reason: err.reason,
    });

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
