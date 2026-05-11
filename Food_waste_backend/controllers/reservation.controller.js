const pool = require("../shared/config/db");
const generatePickupCode = require("../utils/codeGenerator");
const notificationQueue = require("../queues/notification.queue");
const pickupQueue = require("../queues/pickup.queue");
const deliveryQueue = require("../queues/delivery.queue");
const refundQueue = require("../queues/refund.queue");
const paymentQueue = require("../queues/payment.queue");

const { createPayment, cancelPayment } = require("../shared/services/payment.service");
const {
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
  publishVolunteerUpdated,
} = require("../shared/services/realtime.service");
const { isProvided, isValidId, toNumber } = require("../utils/validation");

const withStatus = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const RESERVATION_EXISTS_MESSAGE = "You have already interacted with this listing.";

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

function getCancellationCutoff(pickupEndTime) {
  const cutoff = new Date(pickupEndTime);
  cutoff.setMinutes(cutoff.getMinutes() - 20);
  return cutoff;
}

function isBeforeCancellationCutoff(pickupEndTime) {
  return new Date() <= getCancellationCutoff(pickupEndTime);
}

async function cleanupCancellationQueues(reservationId, orderId) {
  try {
    await pickupQueue.remove(`pickup-${reservationId}`);
    await deliveryQueue.remove(`delivery-${reservationId}`);

    if (orderId) {
      await paymentQueue.remove(`payment-batch-${orderId}`);
    }
  } catch (err) {
    console.warn("Queue cleanup failed:", err.message);
  }
}

async function notifyReservationCancelled(req, reservation) {
  await notificationQueue.add("notify-user", {
    userId: reservation.provider_id,
    type: "reservation_cancelled",
    title: "Reservation Cancelled",
    message: "A user cancelled their reservation.",
  });

  const io = req.app.get("io");
  io.to(`user:${reservation.provider_id}`).emit("reservation:cancelled", {
    reservation_id: reservation.id,
  });
}

exports.createReservation = async (req, res) => {
  if (req.user.role !== "user")
    return res.status(403).json({ error: "Only users allowed" });

  const { listing_id, quantity } = req.body;
  const quantityValue = toNumber(quantity);

  if (!isValidId(listing_id)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  if (!isProvided(quantity) || !Number.isFinite(quantityValue) || quantityValue <= 0) {
    return res.status(400).json({ error: "Valid quantity is required" });
  }

  const client = await pool.connect();

  try {
    if (quantityValue > 2) throw withStatus("Max 2 items allowed", 400);

    await client.query("BEGIN");

    const foodResult = await client.query(
      `SELECT * FROM food_listings WHERE id=$1 FOR UPDATE`,
      [listing_id]
    );

    if (!foodResult.rows.length) throw withStatus("Listing not found", 404);

    const food = foodResult.rows[0];

    /*
    🚨 BLOCK FREE LISTINGS FOR USERS
    */
    if (food.is_free) {
      throw withStatus("Free listings are only available for NGOs", 403);
    }

    await ensureListingNotPreviouslyReserved(
      client,
      req.user.id,
      listing_id
    );

    if (food.remaining_quantity < quantityValue)
      throw withStatus("Not enough quantity", 409);

    /*
    CREATE RESERVATION
    */
    const reservationResult = await client.query(
      `
      INSERT INTO reservations
      (listing_id, user_id, quantity_reserved, pickup_type, task_status, status, pickup_code, payment_status)
      VALUES ($1,$2,$3,'self_pickup','self_pickup','payment_pending',$4,'pending')
      RETURNING *
      `,
      [listing_id, req.user.id, quantityValue, generatePickupCode()]
    );

    const reservation = reservationResult.rows[0];

    const stockUpdate = await client.query(
      `
      UPDATE food_listings
      SET remaining_quantity = remaining_quantity - $1
      WHERE id=$2
      AND remaining_quantity >= $1
      RETURNING remaining_quantity
      `,
      [quantityValue, listing_id]
    );

    if (!stockUpdate.rows.length) {
      throw withStatus("Not enough quantity", 409);
    }

    /*
    💳 PAYMENT (MANDATORY NOW)
    */
    const payment = await createPayment({
      client,
      user: req.user,
      reservations: [reservation],
      totalAmount: Number(food.price) * quantityValue,
    });

    await client.query("COMMIT");

    await Promise.all([
      publishReservationUpdated(reservation.id, { action: "created" }),
      publishPaymentUpdated(reservation.id, { action: "created" }),
      publishListingUpdated(listing_id, { action: "quantity_updated" }),
    ]);

    res.status(201).json({
      reservation,
      payment,
    });

  } catch (err) {
    await client.query("ROLLBACK");

    if (
      err.code === "23505" ||
      err.constraint === "unique_active_reservation"
    ) {
      return res.status(409).json({
        error: RESERVATION_EXISTS_MESSAGE,
      });
    }

    res.status(err.statusCode || 400).json({
      error: err.message || "Reservation failed",
    });
  } finally {
    client.release();
  }
};

exports.getReservationById = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Reservation id is required" });
  }

  const result = await pool.query(
    `SELECT r.*,
            f.provider_id,
            f.title,
            f.description,
            f.pickup_start_time,
            f.pickup_end_time,
            f.is_free,
            f.price,
            provider.name AS provider_name,
            provider.phone AS provider_phone,
            provider.address AS provider_address,
            f.latitude AS provider_latitude,
            f.longitude AS provider_longitude,
            requester.name AS requester_name,
            requester.phone AS requester_phone,
            volunteer.name AS assigned_volunteer_name,
            volunteer.phone AS assigned_volunteer_phone,
            rating.id AS review_id,
            rating.rating AS review_rating,
            rating.review AS review_text
    FROM reservations r
    JOIN food_listings f ON r.listing_id = f.id
    JOIN users provider ON provider.id = f.provider_id
    JOIN users requester ON requester.id = r.user_id
    LEFT JOIN users volunteer ON volunteer.id = r.assigned_volunteer_id
    LEFT JOIN ratings rating ON rating.reservation_id = r.id
    WHERE r.id=$1
    FOR UPDATE OF r`,
    [id],
  );

  if (!result.rows.length) return res.status(404).json({ error: "Not found" });

  const reservation = result.rows[0];
  const isRequester = String(reservation.user_id) === String(req.user.id);
  const isProvider = String(reservation.provider_id) === String(req.user.id);
  const isVolunteer =
    reservation.assigned_volunteer_id !== null &&
    reservation.assigned_volunteer_id !== undefined &&
    String(reservation.assigned_volunteer_id) === String(req.user.id);

  if (!isRequester && !isProvider && !isVolunteer) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (isProvider || isVolunteer) {
    delete reservation.receive_code;
  }

  if (isRequester && req.user.role === "ngo") {
    delete reservation.pickup_code;
  }

  res.json(reservation);
};

exports.getMyReservations = async (req, res) => {
  const result = await pool.query(
    `
    SELECT r.*,
          f.id AS listing_id,
          f.title,
          f.description,
          f.pickup_start_time,
          f.pickup_end_time,
          f.is_free,
          f.price,
          provider.name AS provider_name,
          provider.phone AS provider_phone,
          provider.address AS provider_address,
          f.latitude AS provider_latitude,
          f.longitude AS provider_longitude,
          requester.id AS requester_id,
          requester.name AS requester_name,
          requester.phone AS requester_phone,
          volunteer.name AS assigned_volunteer_name,
          volunteer.phone AS assigned_volunteer_phone,
          CASE
            WHEN r.pickup_type = 'ngo' THEN 'ngo'
            ELSE 'self_pickup'
          END AS reservation_kind
    FROM reservations r
    JOIN food_listings f ON f.id = r.listing_id
    JOIN users provider ON provider.id = f.provider_id
    LEFT JOIN users requester ON requester.id = r.user_id
    LEFT JOIN users volunteer ON volunteer.id = r.assigned_volunteer_id
    WHERE r.user_id = $1
    ORDER BY r.reserved_at DESC NULLS LAST, r.id DESC
    `,
    [req.user.id],
  );

  res.json(result.rows);
};

exports.getProviderReservations = async (req, res) => {
  try {
    if (req.user.role !== "provider")
      return res.status(403).json({ error: "Only providers allowed" });

    const result = await pool.query(
      `
      SELECT r.id,
             r.listing_id,
             r.user_id,
             r.assigned_volunteer_id,
             r.quantity_reserved,
             r.pickup_type,
             r.task_status,
             r.status,
             r.pickup_code,
             r.payment_status,
             r.reserved_at,
             r.assigned_at,
             r.picked_up_at,
             r.completed_at,
             f.id AS listing_id,
             f.title,
             f.description,
             f.pickup_start_time,
             f.pickup_end_time,
             f.is_free,
             f.price,
             requester.id AS requester_id,
             requester.name AS requester_name,
             requester.phone AS requester_phone,
             volunteer.name AS assigned_volunteer_name,
             volunteer.phone AS assigned_volunteer_phone,
             CASE
               WHEN r.pickup_type = 'ngo' THEN 'ngo'
               ELSE 'self_pickup'
             END AS reservation_kind
      FROM reservations r
      JOIN food_listings f ON f.id = r.listing_id
      JOIN users requester ON requester.id = r.user_id
      LEFT JOIN users volunteer ON volunteer.id = r.assigned_volunteer_id
      WHERE f.provider_id = $1
      ORDER BY r.reserved_at DESC NULLS LAST, r.id DESC
      `,
      [req.user.id],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch provider reservations:", err);
    res.status(500).json({
      error: "Failed to fetch provider reservations",
      details: process.env.NODE_ENV === "production" ? undefined : err.message,
    });
  }
};


const legacyCancelReservation = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Reservation id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
    ========================
    1️⃣ LOCK RESERVATION
    ========================
    */
    const result = await client.query(
      `
      SELECT r.*, f.provider_id, f.pickup_end_time
      FROM reservations r
      JOIN food_listings f ON r.listing_id = f.id
      WHERE r.id=$1
      FOR UPDATE
      `,
      [id]
    );

    if (!result.rows.length) throw withStatus("Reservation not found", 404);

    const reservation = result.rows[0];

    /*
    ========================
    2️⃣ AUTH
    ========================
    */
    if (reservation.user_id !== req.user.id) {
      throw withStatus("Unauthorized", 403);
    }

    /*
    ========================
    3️⃣ IDEMPOTENCY
    ========================
    */
    if (reservation.status === "cancelled") {
      throw withStatus("Already cancelled", 409);
    }

    /*
    ========================
    4️⃣ STATUS CHECK
    ========================
    */
    if (!["reserved", "payment_pending"].includes(reservation.status)) {
      throw withStatus("Cannot cancel this reservation", 400);
    }

    if (
      reservation.pickup_type === "ngo" &&
      reservation.task_status !== "pending"
    ) {
      throw withStatus(
        "Cannot cancel after volunteer started",
        400
      );
    }

    /*
    ========================
    5️⃣ TIME WINDOW
    ========================
    */
    const now = new Date();
    const cutoff = new Date(reservation.pickup_end_time);
    cutoff.setMinutes(cutoff.getMinutes() - 20);

    if (now > cutoff) {
      throw withStatus("Cancellation window closed", 400);
    }

    /*
    ========================
    6️⃣ HANDLE PAYMENT STATE
    ========================
    */

    if (reservation.payment_status === "pending") {
      // 🔥 Cancel payment (no refund)
      await cancelPayment(client, reservation.id);
      await client.query(
        `
        UPDATE reservations
        SET payment_status='failed'
        WHERE id=$1
        `,
        [id]
      );
    }

    /*
    ========================
    7️⃣ RESTORE QUANTITY
    ========================
    */
    await client.query(
      `
      UPDATE food_listings
      SET remaining_quantity = remaining_quantity + $1
      WHERE id=$2
      `,
      [reservation.quantity_reserved, reservation.listing_id]
    );

    /*
    ========================
    8️⃣ CANCEL RESERVATION
    ========================
    */
    await client.query(
      `
      UPDATE reservations
      SET status='cancelled'
      WHERE id=$1
      `,
      [id]
    );

    await client.query("COMMIT");

    /*
    ========================
    9️⃣ CLEAN QUEUES
    ========================
    */
    try {
      await pickupQueue.remove(`pickup-${id}`);
      await deliveryQueue.remove(`delivery-${id}`);
    } catch (err) {
      console.warn("Queue cleanup failed:", err.message);
    }

    /*
    ========================
    🔟 REFUND (ONLY IF PAID)
    ========================
    */
    if (reservation.payment_status === "paid") {
      await refundQueue.add(
        "refund-payment",
        { reservationId: reservation.id },
        {
          jobId: `refund-${reservation.id}`,
          attempts: 5,
        }
      );
    }

    /*
    ========================
    🔔 NOTIFY PROVIDER
    ========================
    */
    await notificationQueue.add("notify-user", {
      userId: reservation.provider_id,
      type: "reservation_cancelled",
      title: "Reservation Cancelled",
      message: "A user cancelled their reservation.",
    });

    /*
    ========================
    🔌 SOCKET
    ========================
    */
    const io = req.app.get("io");
    io.to(`user:${reservation.provider_id}`).emit("reservation:cancelled", {
      reservation_id: id,
    });

    res.json({ message: "Cancelled successfully" });

  } catch (err) {
    await client.query("ROLLBACK");

    res.status(err.statusCode || 400).json({
      error: err.message || "Cancellation failed",
    });
  } finally {
    client.release();
  }
};

exports.cancelReservation = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Reservation id is required" });
  }

  const client = await pool.connect();
  let refundReservationId = null;
  let paymentTimeoutOrderId = null;
  let cancelledReservation = null;
  let committed = false;

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT r.*, f.provider_id, f.pickup_end_time, f.is_free
      FROM reservations r
      JOIN food_listings f ON r.listing_id = f.id
      WHERE r.id=$1
      FOR UPDATE
      `,
      [id]
    );

    if (!result.rows.length) throw withStatus("Reservation not found", 404);

    const reservation = result.rows[0];

    if (reservation.user_id !== req.user.id) {
      throw withStatus("Unauthorized", 403);
    }

    if (reservation.status === "cancelled") {
      throw withStatus("Already cancelled", 409);
    }

    if (!["reserved", "payment_pending"].includes(reservation.status)) {
      throw withStatus("Cannot cancel this reservation", 400);
    }

    if (reservation.pickup_type === "ngo") {
      if (reservation.task_status !== "pending") {
        throw withStatus("Cannot cancel after volunteer started", 400);
      }

      await client.query(
        `
        UPDATE food_listings
        SET remaining_quantity = remaining_quantity + $1
        WHERE id=$2
        `,
        [reservation.quantity_reserved, reservation.listing_id]
      );

      await client.query(
        `
        UPDATE reservations
        SET status='cancelled'
        WHERE id=$1
        `,
        [reservation.id]
      );
    } else {
      if (reservation.pickup_type !== "self_pickup") {
        throw withStatus("Unsupported reservation type", 400);
      }

      if (!isBeforeCancellationCutoff(reservation.pickup_end_time)) {
        throw withStatus(
          "Cancellation window closed. This reservation is no longer refundable.",
          400
        );
      }

      const paymentResult = await client.query(
        `
        SELECT *
        FROM payments
        WHERE reservation_id=$1
        FOR UPDATE
        `,
        [reservation.id]
      );
      const payment = paymentResult.rows[0];
      paymentTimeoutOrderId = payment?.order_id || null;

      if (reservation.payment_status === "paid") {
        if (!payment) {
          throw withStatus("Payment record not found for refund", 409);
        }

        await client.query(
          `
          UPDATE payments
          SET status='refund_pending',
              refund_status='refund_pending',
              updated_at=NOW()
          WHERE id=$1
          AND status IN ('paid', 'success', 'refund_pending')
          `,
          [payment.id]
        );

        await client.query(
          `
          UPDATE reservations
          SET status='cancelled',
              payment_status='refund_pending'
          WHERE id=$1
          `,
          [reservation.id]
        );

        refundReservationId = reservation.id;
      } else if (reservation.payment_status === "pending") {
        await cancelPayment(client, reservation.id);

        await client.query(
          `
          UPDATE reservations
          SET status='cancelled',
              payment_status='failed'
          WHERE id=$1
          `,
          [reservation.id]
        );
      } else if (
        ["refund_pending", "refunded", "refund_failed"].includes(
          reservation.payment_status
        )
      ) {
        throw withStatus("Reservation refund is already in progress", 409);
      } else {
        throw withStatus("Reservation payment is not refundable", 400);
      }

      await client.query(
        `
        UPDATE food_listings
        SET remaining_quantity = remaining_quantity + $1
        WHERE id=$2
        `,
        [reservation.quantity_reserved, reservation.listing_id]
      );
    }

    cancelledReservation = reservation;
    await client.query("COMMIT");
    committed = true;

    await cleanupCancellationQueues(reservation.id, paymentTimeoutOrderId);

    if (refundReservationId) {
      try {
        await refundQueue.add(
          "refund-payment",
          { reservationId: refundReservationId },
          {
            jobId: `refund-${refundReservationId}`,
            attempts: 5,
            backoff: { type: "exponential", delay: 3000 },
          }
        );
      } catch (err) {
        console.error("Failed to enqueue refund:", err.message);
      }
    }

    try {
      await notifyReservationCancelled(req, cancelledReservation);
    } catch (err) {
      console.warn("Cancellation notification failed:", err.message);
    }

    await Promise.all([
      publishReservationUpdated(reservation.id, { action: "cancelled" }),
      publishTaskAvailabilityUpdated(reservation.id, { action: "unavailable" }),
      publishPaymentUpdated(reservation.id, {
        action: refundReservationId ? "refund_pending" : "cancelled",
      }),
      publishListingUpdated(reservation.listing_id, { action: "quantity_updated" }),
    ]);

    res.json({
      message: refundReservationId
        ? "Cancelled successfully. Refund is being processed."
        : "Cancelled successfully",
    });
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }

    res.status(err.statusCode || 400).json({
      error: err.message || "Cancellation failed",
    });
  } finally {
    client.release();
  }
};

exports.markAsPickedUp = async (req, res) => {
  const { id } = req.params;
  const { pickup_code } = req.body;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Reservation id is required" });
  }

  if (!isProvided(pickup_code)) {
    return res.status(400).json({ error: "Pickup code is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reservationResult = await client.query(
      `
      SELECT r.*, f.provider_id
      FROM reservations r
      JOIN food_listings f ON r.listing_id = f.id
      WHERE r.id=$1
      FOR UPDATE
      `,
      [id]
    );

    if (!reservationResult.rows.length)
      throw withStatus("Reservation not found", 404);

    const reservation = reservationResult.rows[0];

    if (reservation.provider_id !== req.user.id)
      throw withStatus("Only provider can confirm pickup", 403);

    if (reservation.status !== "reserved")
      throw withStatus("Reservation is not active", 409);

    if (reservation.pickup_code !== pickup_code)
      throw withStatus("Invalid pickup code", 400);

    if (
      reservation.pickup_type === "ngo" &&
      reservation.task_status !== "in_progress"
    )
      throw withStatus("Volunteer has not started pickup", 400);

    const isNGOPickup = reservation.pickup_type === "ngo";
    const update = await client.query(
      isNGOPickup
        ? `
          UPDATE reservations
          SET task_status='picked_from_provider',
              picked_up_at = NOW()
          WHERE id=$1
          RETURNING *
          `
        : `
          UPDATE reservations
          SET task_status='picked_up',
              status='picked_up',
              picked_up_at = NOW(),
              completed_at = NOW()
          WHERE id=$1
          RETURNING *
          `,
      [id]
    );

    await client.query("COMMIT");

    await Promise.all([
      publishReservationUpdated(id, {
        action: isNGOPickup ? "picked_from_provider" : "picked_up",
      }),
      publishVolunteerUpdated(id, {
        action: isNGOPickup ? "pickup_confirmed" : "self_pickup_completed",
      }),
      publishTaskAvailabilityUpdated(id, {
        action: isNGOPickup ? "pickup_confirmed" : "unavailable",
      }),
    ]);

    if (isNGOPickup) {
      // cancel pickup timeout
      await pickupQueue.remove(`pickup-${id}`);

      // correct delivery timing
      const assignedAt = new Date(reservation.assigned_at).getTime();
      const pickupDeadline = assignedAt + 15 * 60 * 1000;
      const deliveryDeadline = pickupDeadline + 30 * 60 * 1000;

      const delay = Math.max(deliveryDeadline - Date.now(), 0);

      await deliveryQueue.add(
        "delivery-timeout",
        { reservationId: id },
        {
          delay,
          jobId: `delivery-${id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 3600, count: 1000 }
        }
      );

      console.log("🚚 Delivery timeout scheduled:", id);
    }

    res.json({
      message: isNGOPickup
        ? "Pickup confirmed. Volunteer must deliver to NGO."
        : "Pickup confirmed successfully.",
    });

  } catch (err) {
    await client.query("ROLLBACK");

    res.status(err.statusCode || 400).json({
      error: err.message,
    });
  } finally {
    client.release();
  }
};
