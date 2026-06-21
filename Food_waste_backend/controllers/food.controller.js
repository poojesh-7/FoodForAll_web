const pool = require("../shared/config/db");
const crypto = require("crypto");

const notificationQueue = require("../queues/notification.queue");
const { ensureFoodListingSoftDeleteSchema } = require("../shared/services/foodListingSchema.service");
const { resolveProviderDisplayName } = require("../shared/services/providerDisplay.service");
const {
  blockingReservationWhere,
} = require("../shared/services/reservationLock.service");
const { publishListingUpdated } = require("../shared/services/realtime.service");
const {
  notifyAdminsProviderVerificationSubmitted,
} = require("../shared/services/operationalNotification.service");
const logger = require("../shared/utils/logger");
const { jobOptions } = require("../shared/utils/queueOptions");
const { operationalPolicy } = require("../shared/config/operationalPolicy");
const {
  normalizeQuantityUnitFields,
} = require("../shared/services/quantityUnit.service");
const {
  appendDiscoveryWhere,
  buildDiscoveryOrder,
  normalizeCategory,
  normalizeDietaryTags,
  normalizeDiscoveryFilters,
} = require("../shared/services/listingDiscovery.service");
const {
  addListingImages,
  deleteRemovedImages,
  listingImagesSelect,
  normalizeListingImages,
  parseJsonArray,
  updateListingImages,
} = require("../shared/services/listingImage.service");
const {
  providerReviewAggregateJoin,
  providerReviewSummarySelect,
} = require("../shared/services/reviewSummary.service");
const {
  sanitizeOptionalText,
} = require("../shared/utils/sanitize");
const {
  normalizeBusinessName,
  normalizeFssaiNumber,
  normalizeRequiredText,
  normalizeServiceRadiusKm,
} = require("../utils/fieldValidation");
const {
  isIntegerInRange,
  isNumberInRange,
  isProvided,
  isValidId,
  isValidLatitude,
  isValidLongitude,
  toNumber,
} = require("../utils/validation");

function isFreeRescueListing(food) {
  return Boolean(food.is_free) || Number(food.price) === 0;
}

const NGO_PROVIDER_REQUEST_BLOCK_LEVEL = 5;
const eligibleNGOForProviderRequestsWhere = `
  n.is_verified = true
  AND u.role = 'ngo'
  AND (u.banned_until IS NULL OR u.banned_until <= NOW())
  AND (u.cooldown_until IS NULL OR u.cooldown_until <= NOW())
  AND NULLIF(TRIM(n.organization_name), '') IS NOT NULL
  AND LOWER(TRIM(n.organization_name)) <> 'anonymized ngo'
  AND LOWER(TRIM(COALESCE(u.name, ''))) NOT LIKE 'deleted user %'
  AND LOWER(TRIM(COALESCE(u.phone, ''))) NOT LIKE 'deleted%'
  AND COALESCE(
    ts.projected_restriction_level,
    ts.restriction_level,
    0
  ) < ${NGO_PROVIDER_REQUEST_BLOCK_LEVEL}
  AND (
    COALESCE(ts.projected_cooldown_until, ts.cooldown_until) IS NULL
    OR COALESCE(ts.projected_cooldown_until, ts.cooldown_until) <= NOW()
  )
`;

exports.registerRestaurant = async (req, res) => {
  try {
    const userId = req.user.id;

    // 🔹 Fetch user
    const userResult = await pool.query(
      "SELECT id, role, phone, name, email FROM users WHERE id=$1",
      [userId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    if (!user.phone || !user.name || !user.email) {
      return res.status(409).json({
        error: "Complete profile with phone contact before provider onboarding",
      });
    }

    if (!["user", "volunteer", "provider"].includes(user.role)) {
      logger.security("Blocked provider onboarding application", {
        reason: "ineligible_current_role",
        userId,
        role: user.role,
      });

      return res.status(403).json({
        error: "This account cannot apply for provider verification",
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
    const serviceRadius = normalizeServiceRadiusKm(service_radius_km, 5);

    if (!req.file) {
      return res.status(400).json({
        error: "FSSAI certificate image required",
      });
    }

    const normalizedName = normalizeBusinessName(
      restaurant_name,
      "Restaurant or provider name"
    );
    const normalizedFssai = normalizeFssaiNumber(fssai_number);

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
    const storagePrefix = process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local";
    const certificateNonce =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString("hex");
    const uploadedImage = await uploadBuffer(req.file.buffer, {
      folder: `food-rescue/${storagePrefix}/fssai`,
      public_id: `provider_${userId}_fssai_${certificateNonce}`,
      overwrite: true,
      invalidate: true,
      mimetype: req.file.mimetype,
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
        role = 'provider',
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
    void notifyAdminsProviderVerificationSubmitted({
      providerId: result.rows[0].user_id,
      restaurantId: result.rows[0].id,
    });

  } catch (err) {
    logger.error("Restaurant registration failed", {
      err,
      userId: req.user?.id,
    });

    // 🔹 Duplicate errors
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Restaurant already exists (duplicate entry)",
      });
    }

    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
      });
    }

    res.status(500).json({
      error: "Restaurant registration failed",
    });
  }
};

exports.getMyRestaurant = async (req, res) => {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers allowed" });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM restaurants
      WHERE user_id=$1
      ORDER BY id DESC
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Restaurant profile not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("Restaurant profile fetch failed", {
      err,
      userId: req.user?.id,
    });

    res.status(500).json({ error: "Restaurant profile fetch failed" });
  }
};

const expiryQueue = require("../queues/expiry.queue");
const alertQueue = require("../queues/expiryAlert.queue");

function expiryJobId(listingId) {
  return `expiry-${listingId}`;
}

function expiryAlertJobId(listingId) {
  return `alert-${listingId}`;
}

function expiryDelayFromEndTime(endTimeMs) {
  return Math.max(endTimeMs - Date.now(), 0);
}

function expiryAlertDelayFromEndTime(endTimeMs) {
  return Math.max(
    endTimeMs - operationalPolicy.food.expiryAlertLeadMs - Date.now(),
    0
  );
}

async function removeExpiryJobs(listingId) {
  await Promise.all([
    expiryQueue.remove(expiryJobId(listingId)),
    alertQueue.remove(expiryAlertJobId(listingId)),
  ]);
}

async function scheduleExpiryJobs(listingId, endTimeMs) {
  await Promise.all([
    expiryQueue.add(
      "expire-food",
      { listingId },
      jobOptions("critical", {
        delay: expiryDelayFromEndTime(endTimeMs),
        jobId: expiryJobId(listingId),
      })
    ),
    alertQueue.add(
      "expiry-alert",
      { listingId },
      jobOptions("critical", {
        delay: expiryAlertDelayFromEndTime(endTimeMs),
        jobId: expiryAlertJobId(listingId),
      })
    ),
  ]);
}

async function rescheduleExpiryJobs(listingId, endTimeMs) {
  await removeExpiryJobs(listingId);
  await scheduleExpiryJobs(listingId, endTimeMs);
}

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

    await ensureFoodListingSoftDeleteSchema(client);

    const { latitude, longitude } = restaurantResult.rows[0];

    let {
      title,
      description,
      quantity,
      quantity_unit,
      custom_quantity_unit,
      category,
      dietary_tags,
      price,
      is_free,
      pickup_start_time,
      pickup_end_time,
    } = req.body;

    // 🔹 Normalize
    title = normalizeRequiredText(title, {
      field: "Food title",
      minLength: 3,
      maxLength: 160,
      pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &.,'()/_-]{2,159}$/u,
      patternMessage:
        "Food title can contain letters, numbers, spaces, and common punctuation",
    });
    description = sanitizeOptionalText(description, {
      maxLength: 2000,
      preserveNewlines: true,
    });
    quantity = Number(quantity);
    price = Number(price) || 0;
    is_free = is_free === true || is_free === "true";
    const quantityMetadata = normalizeQuantityUnitFields({
      quantity_unit,
      custom_quantity_unit,
    });
    const listingCategory = normalizeCategory(category, { required: true });
    const dietaryTags = normalizeDietaryTags(dietary_tags ?? req.body.dietaryTags);

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

    if (endTime - now < operationalPolicy.food.minPickupWindowMs) {
      return res.status(400).json({
        error: `Minimum pickup window is ${operationalPolicy.food.minPickupWindowMinutes} minutes`,
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
        quantity_unit,
        custom_quantity_unit,
        category,
        dietary_tags,
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
        $9,
        $10,
        $11,
        $12,
        $13::double precision,
        $14::double precision,
        ST_SetSRID(
          ST_MakePoint(
            $14::double precision,
            $13::double precision
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
        quantityMetadata.quantityUnit,
        quantityMetadata.customQuantityUnit,
        listingCategory,
        dietaryTags,
        price,
        is_free,
        pickup_start_time,
        pickup_end_time,
        latitude,
        longitude,
      ]
    );

    const listing = result.rows[0];
    const images = await addListingImages(client, listing.id, req.files || []);
    const responseListing = normalizeListingImages({
      ...listing,
      images,
      primary_image_url: images[0]?.image_url || null,
    });

    /*
    ========================
    QUEUES
    ========================
    */

    await scheduleExpiryJobs(listing.id, endTime);

    await client.query("COMMIT");

    // 🔹 Realtime
    req.app.get("io").emit("food:new", responseListing);
    await publishListingUpdated(listing.id, {
      action: "created",
      listing: responseListing,
    });

    res.status(201).json({
      message: "Food created successfully",
      listing: responseListing,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Food creation failed", {
      err,
      userId: req.user?.id,
    });

    if (err.code === "23505") {
      return res.status(409).json({
        error: "Duplicate listing",
      });
    }

    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
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

  await ensureFoodListingSoftDeleteSchema();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const food = await client.query(
      "SELECT * FROM food_listings WHERE id=$1 FOR UPDATE",
      [id],
    );

    if (food.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    const current = food.rows[0];

    if (current.provider_id !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (current.is_deleted || current.status === "deleted") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Archived listings cannot be edited" });
    }

    const {
      title,
      description,
      price,
      is_free,
      quantity,
      quantity_unit,
      custom_quantity_unit,
      category,
      dietary_tags,
      pickup_end_time,
    } =
      req.body;
    const quantityMetadata = normalizeQuantityUnitFields(
      {
        quantity_unit,
        custom_quantity_unit:
          custom_quantity_unit !== undefined
            ? custom_quantity_unit
            : current.custom_quantity_unit,
      },
      current.quantity_unit || "Piece"
    );
    const sanitizedTitle = normalizeRequiredText(title, {
      field: "Food title",
      minLength: 3,
      maxLength: 160,
      pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &.,'()/_-]{2,159}$/u,
      patternMessage:
        "Food title can contain letters, numbers, spaces, and common punctuation",
    });
    const sanitizedDescription = sanitizeOptionalText(description, {
      maxLength: 2000,
      preserveNewlines: true,
    });
    const listingCategory =
      category !== undefined
        ? normalizeCategory(category, { required: true })
        : current.category || "other";
    const dietaryTags =
      dietary_tags !== undefined || req.body.dietaryTags !== undefined
        ? normalizeDietaryTags(dietary_tags ?? req.body.dietaryTags)
        : current.dietary_tags || [];
    const endTime = new Date(pickup_end_time).getTime();
    const originalStartTime = new Date(current.pickup_start_time).getTime();

    if (!isProvided(sanitizedTitle) || !isProvided(pickup_end_time)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Title and pickup end time are required" });
    }

    if (!Number.isFinite(endTime) || endTime <= Date.now()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Pickup end time must be in the future" });
    }

    if (Number.isFinite(originalStartTime) && originalStartTime >= endTime) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Pickup end time must be after pickup start" });
    }

    const reservationSummary = await client.query(
      `
      SELECT COUNT(*)::int AS reservation_count
      FROM reservations
      WHERE listing_id=$1
      AND ${blockingReservationWhere()}
      `,
      [id],
    );
    const reservationCount = reservationSummary.rows[0]?.reservation_count || 0;

    const currentQuantity = toNumber(current.quantity);
    const currentRemaining = toNumber(current.remaining_quantity);
    const nextQuantity = isProvided(quantity) ? toNumber(quantity) : currentQuantity;

    if (!isIntegerInRange(nextQuantity, 1, 10000)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Quantity must be greater than 0" });
    }

    const quantityDelta = nextQuantity - currentQuantity;
    const nextRemaining = currentRemaining + quantityDelta;

    if (nextRemaining < 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Quantity cannot be lower than already reserved items",
      });
    }

    const requestedFree =
      is_free === true || is_free === "true"
        ? true
        : is_free === false || is_free === "false"
          ? false
          : Boolean(current.is_free);
    const requestedPrice = isProvided(price) ? toNumber(price) : toNumber(current.price);
    const nextPrice = requestedFree ? 0 : requestedPrice;
    const pricingChanged =
      requestedFree !== Boolean(current.is_free) ||
      Number(nextPrice) !== Number(current.price);

    if (pricingChanged && reservationCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Price and free status cannot be changed after reservations exist",
      });
    }

    if (!Number.isFinite(nextPrice) || nextPrice < 0 || nextPrice > 100000) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid price" });
    }

    if (!requestedFree && nextPrice <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Paid food must have valid price" });
    }

    const result = await client.query(
      `UPDATE food_listings
       SET title=$1,
           description=$2,
           quantity=$3,
           remaining_quantity=$4,
           quantity_unit=$5,
           custom_quantity_unit=$6,
           category=$7,
           dietary_tags=$8,
           price=$9,
           is_free=$10,
           pickup_end_time=$11
       WHERE id=$12
       RETURNING *`,
      [
        sanitizedTitle,
        sanitizedDescription,
        nextQuantity,
        nextRemaining,
        quantityMetadata.quantityUnit,
        quantityMetadata.customQuantityUnit,
        listingCategory,
        dietaryTags,
        nextPrice,
        requestedFree,
        pickup_end_time,
        id,
      ],
    );
    const removedPublicIds = parseJsonArray(req.body.removed_image_public_ids).map(
      (item) => String(item)
    );
    const images = await updateListingImages(
      client,
      id,
      req.body,
      req.files || []
    );
    const responseListing = normalizeListingImages({
      ...result.rows[0],
      images,
      primary_image_url: images[0]?.image_url || null,
    });

    const expiryTimingChanged =
      new Date(current.pickup_end_time).getTime() !==
      new Date(responseListing.pickup_end_time).getTime();

    if (expiryTimingChanged) {
      await rescheduleExpiryJobs(id, endTime);
    }

    await client.query("COMMIT");

    await deleteRemovedImages(removedPublicIds);

    await publishListingUpdated(id, {
      action: "updated",
      listing: responseListing,
    });

    res.json(responseListing);
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Food update failed", { err, listingId: id, userId: req.user?.id });
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    res.status(500).json({ error: "Food update failed" });
  } finally {
    client.release();
  }
};

// DELETE FOOD
exports.deleteFood = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Food id is required" });
  }

  await ensureFoodListingSoftDeleteSchema();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const food = await client.query(
      "SELECT * FROM food_listings WHERE id=$1 FOR UPDATE",
      [id],
    );

    if (food.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    if (food.rows[0].provider_id !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Unauthorized" });
    }

    const activeReservations = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM reservations
      WHERE listing_id=$1
      AND ${blockingReservationWhere()}
      `,
      [id],
    );

    if (Number(activeReservations.rows[0]?.count ?? 0) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Cannot delete listing with active reservations.",
      });
    }

    const result = await client.query(
      `
      UPDATE food_listings
      SET is_deleted=true,
          deleted_at=COALESCE(deleted_at, NOW()),
          status='deleted'
      WHERE id=$1
      RETURNING *
      `,
      [id],
    );

    await removeExpiryJobs(id);

    await client.query("COMMIT");

    await publishListingUpdated(id, {
      action: "deleted",
      listing: result.rows[0],
    });

    res.json({
      message: "Listing archived successfully.",
      listing: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Food deletion failed", {
      err,
      listingId: id,
      userId: req.user?.id,
    });
    res.status(500).json({ error: "Food deletion failed" });
  } finally {
    client.release();
  }
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
  const params = [];

  try {
    const filters = normalizeDiscoveryFilters(req.query);
    const clauses = [];
    appendDiscoveryWhere(clauses, params, filters);
    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const orderBy = buildDiscoveryOrder(filters, { defaultSort: "newest" });
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;
    params.push(limitValue, offset);

    const result = await pool.query(
      `SELECT f.*,
              ${listingImagesSelect("f")},
              ${providerReviewSummarySelect()},
              u.name AS provider_name,
              u.profile_image_url AS provider_profile_image_url,
              restaurant.restaurant_name
       FROM food_listings f
       JOIN users u ON u.id = f.provider_id
       ${providerReviewAggregateJoin("f")}
       LEFT JOIN LATERAL (
         SELECT restaurant_name
         FROM restaurants
         WHERE user_id = f.provider_id
         ORDER BY is_verified DESC, id DESC
         LIMIT 1
       ) restaurant ON true
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params,
    );

    res.json(result.rows.map(normalizeListingImages));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    logger.error("Food listing fetch failed", { err });
    res.status(500).json({ error: "Food listing fetch failed" });
  }
};

// GET ACTIVE FOOD
exports.getActiveFood = async (req, res) => {
  await ensureFoodListingSoftDeleteSchema();

  const { lat, lng, radius = 5 } = req.query;
  const hasLat = isProvided(lat);
  const hasLng = isProvided(lng);
  let filters;

  try {
    filters = normalizeDiscoveryFilters(req.query);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  // 🔹 If no location → fallback
  if (!hasLat && !hasLng) {
    const params = [];
    const clauses = [
      "f.status = 'active'",
      "f.is_deleted = false",
      "f.pickup_end_time > NOW()",
      "f.remaining_quantity > 0",
    ];
    appendDiscoveryWhere(clauses, params, filters);
    const orderBy = buildDiscoveryOrder(filters);
    const result = await pool.query(
      `SELECT f.*,
              ${listingImagesSelect("f")},
              ${providerReviewSummarySelect()},
              u.name AS provider_name,
              u.profile_image_url AS provider_profile_image_url,
              restaurant.restaurant_name
       FROM food_listings f
       JOIN users u ON u.id = f.provider_id
       ${providerReviewAggregateJoin("f")}
       LEFT JOIN LATERAL (
         SELECT restaurant_name
         FROM restaurants
         WHERE user_id = f.provider_id
         ORDER BY is_verified DESC, id DESC
         LIMIT 1
       ) restaurant ON true
       WHERE ${clauses.join(" AND ")}
       ORDER BY ${orderBy}`,
      params
    );

    return res.json(result.rows.map(normalizeListingImages));
  }

  if (hasLat !== hasLng) {
    return res.status(400).json({ error: "Latitude and longitude required" });
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const radiusValue = filters.distance ?? toNumber(radius);

  if (!isNumberInRange(radiusValue, 0.1, 100)) {
    return res.status(400).json({ error: "Radius must be between 0.1 and 100 km" });
  }

  const distanceExpression = `
      ST_Distance(
        f.location,
        ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
      )
    `;
  const params = [toNumber(lat), toNumber(lng), radiusValue];
  const clauses = [
    "f.status = 'active'",
    "f.is_deleted = false",
    "f.pickup_end_time > NOW()",
    "f.remaining_quantity > 0",
    `ST_DWithin(
      f.location,
      ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,
      $3 * 1000
    )`,
  ];
  appendDiscoveryWhere(clauses, params, filters, { distanceExpression });
  const orderBy = buildDiscoveryOrder(filters, {
    distanceExpression,
    defaultSort: "nearest",
  });

  // 🔥 GEO QUERY
  const result = await pool.query(
    `
    SELECT f.*,
    ${listingImagesSelect("f")},
    ${providerReviewSummarySelect()},
    u.name AS provider_name,
    u.profile_image_url AS provider_profile_image_url,
    restaurant.restaurant_name,
    ST_Distance(
      f.location,
      ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
    ) AS distance,
    (
      ST_Distance(
        f.location,
        ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
      ) / 1000.0
    )::double precision AS "distanceKm"
    FROM food_listings f
    JOIN users u ON u.id = f.provider_id
    ${providerReviewAggregateJoin("f")}
    LEFT JOIN LATERAL (
      SELECT restaurant_name
      FROM restaurants
      WHERE user_id = f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy}
    `,
    params
  );

  res.json(result.rows.map(normalizeListingImages));
};

// GET FOOD BY ID
exports.getFoodById = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Food id is required" });
  }

  await ensureFoodListingSoftDeleteSchema();

  const result = await pool.query(
    `
    SELECT f.*,
           ${listingImagesSelect("f")},
           ${providerReviewSummarySelect()},
           u.name AS provider_name,
           u.profile_image_url AS provider_profile_image_url,
           restaurant.restaurant_name,
           (
             SELECT COUNT(*)::int
             FROM reservations r
             WHERE r.listing_id=f.id
             AND ${blockingReservationWhere("r")}
           ) AS reservation_count
    FROM food_listings f
    JOIN users u ON u.id = f.provider_id
    ${providerReviewAggregateJoin("f")}
    LEFT JOIN LATERAL (
      SELECT restaurant_name
      FROM restaurants
      WHERE user_id = f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    WHERE f.id=$1
    `,
    [id]
  );

  if (result.rows.length === 0)
    return res.status(404).json({ error: "Not found" });

  res.json(normalizeListingImages(result.rows[0]));
};

// GET NEARBY FOOD (basic radius search)
exports.getNearbyFood = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query;

  await ensureFoodListingSoftDeleteSchema();

  if (!isProvided(lat) || !isProvided(lng)) {
    return res.status(400).json({ error: "Latitude and longitude required" });
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  let filters;

  try {
    filters = normalizeDiscoveryFilters(req.query);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  const radiusValue = filters.distance ?? toNumber(radius);

  if (!isNumberInRange(radiusValue, 0.1, 100)) {
    return res.status(400).json({ error: "Radius must be between 0.1 and 100 km" });
  }

  const distanceExpression = `
      ST_Distance(
        f.location,
        ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
      )
    `;
  const params = [toNumber(lat), toNumber(lng), radiusValue];
  const clauses = [
    "f.status='active'",
    "f.is_deleted = false",
    "f.pickup_end_time > NOW()",
    "f.remaining_quantity > 0",
    `ST_DWithin(
        f.location,
        ST_SetSRID(ST_MakePoint($2,$1),4326)::geography,
        $3*1000
    )`,
  ];
  appendDiscoveryWhere(clauses, params, filters, { distanceExpression });
  const orderBy = buildDiscoveryOrder(filters, {
    distanceExpression,
    defaultSort: "nearest",
  });

  const result = await pool.query(
    `
    SELECT f.id,
           f.title,
           f.description,
           f.remaining_quantity,
           f.quantity_unit,
           f.custom_quantity_unit,
           f.category,
           f.dietary_tags,
           f.pickup_end_time,
           f.status,
           f.is_free,
           f.price,
           ${listingImagesSelect("f")},
           ${providerReviewSummarySelect()},
           u.name AS provider_name,
           u.profile_image_url AS provider_profile_image_url,
           restaurant.restaurant_name,
           (
             ST_Distance(
               f.location,
               ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
             ) / 1000.0
           )::double precision AS "distanceKm"
    FROM food_listings f
    JOIN users u ON u.id = f.provider_id
    ${providerReviewAggregateJoin("f")}
    LEFT JOIN LATERAL (
      SELECT restaurant_name
      FROM restaurants
      WHERE user_id = f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy};
    `,
    params,
  );

  res.json(result.rows.map(normalizeListingImages));
};

// 🔍 View NGOs
exports.viewNGOs = async (req, res) => {
  const result = await pool.query(`
    SELECT n.id, n.organization_name, n.urgent_flag
    FROM ngos n
    JOIN users u ON u.id=n.user_id
    LEFT JOIN trust_scores ts
      ON ts.subject_type='ngo'
     AND ts.subject_id=u.id
    WHERE ${eligibleNGOForProviderRequestsWhere}
    ORDER BY n.urgent_flag DESC, n.organization_name ASC
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
    SELECT f.*,
           u.name AS provider_name,
           u.profile_image_url AS provider_profile_image_url,
           restaurant.restaurant_name
    FROM food_listings f
    JOIN users u ON u.id=f.provider_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name
      FROM restaurants
      WHERE user_id=f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    WHERE f.id=$1 AND f.provider_id=$2
    `,
    [listingId, req.user.id]
  );

  if (!listing.rows.length)
    return res.status(404).json({ error: "Listing not found" });

  const food = listing.rows[0];
  const providerDisplayName = resolveProviderDisplayName(food);

  if (!isFreeRescueListing(food)) {
    return res.status(403).json({
      error: "NGO rescue is only available for free listings.",
    });
  }

  // ⏱ Time check
  const endTime = new Date(food.pickup_end_time).getTime();
  if (endTime - Date.now() < operationalPolicy.food.minNgoRescueRemainingMs) {
    return res.status(400).json({
      error: `Cannot request NGO: less than ${
        operationalPolicy.food.minNgoRescueRemainingMinutes
      } minutes remaining`,
    });
  }

  // 🔥 Get NGO user
  const ngoUser = await pool.query(
    `SELECT user_id FROM ngos WHERE id=$1 AND is_verified=true`,
    [ngo_id]
  );

  if (!ngoUser.rows.length)
    return res.status(404).json({ error: "Verified NGO not found" });

  const eligibleNGO = await pool.query(
    `
    SELECT n.user_id
    FROM ngos n
    JOIN users u ON u.id=n.user_id
    LEFT JOIN trust_scores ts
      ON ts.subject_type='ngo'
     AND ts.subject_id=u.id
    WHERE n.id=$1
    AND ${eligibleNGOForProviderRequestsWhere}
    `,
    [ngo_id]
  );

  if (!eligibleNGO.rows.length) {
    logger.security("Blocked provider request to ineligible NGO", {
      providerId: req.user?.id,
      listingId,
      ngoId: ngo_id,
    });
    return res.status(403).json({ error: "NGO is not eligible for new requests" });
  }

  const ngoUserId = eligibleNGO.rows[0].user_id;

  // 🚨 2️⃣ Already owns listing?
  const existingReservation = await pool.query(
    `
    SELECT id
    FROM reservations
    WHERE listing_id=$1
    AND user_id=$2
    AND pickup_type='ngo'
    AND ${blockingReservationWhere()}
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
    message: `${providerDisplayName} requested your NGO to collect food: ${food.title}`,
  });

  const io = req.app.get("io");
  io?.to(`user:${ngoUserId}`).emit("ngo:request_received", {
    listing_id: listingId,
  });

  res.json({ message: "NGO request sent successfully" });
};
