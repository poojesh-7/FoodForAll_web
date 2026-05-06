const pool = require("../shared/config/db");
const generatePickupCode = require("../utils/codeGenerator");
const notificationQueue = require("../queues/notification.queue");
const pickupQueue = require("../queues/pickup.queue");
const deliveryQueue = require("../queues/delivery.queue");
const refundQueue = require("../queues/refund.queue");


const paymentQueue = require("../queues/payment.queue");

const { createPayment,cancelPayment } = require("../shared/services/payment.service");
const { isProvided, isValidId, toNumber } = require("../utils/validation");

const withStatus = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

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

    if (food.remaining_quantity < quantityValue)
      throw withStatus("Not enough quantity", 409);

    /*
    CREATE RESERVATION
    */
    const reservationResult = await client.query(
      `
      INSERT INTO reservations
      (listing_id, user_id, quantity_reserved, task_status, pickup_code, payment_status)
      VALUES ($1,$2,$3,'self_pickup',$4,'pending')
      RETURNING *
      `,
      [listing_id, req.user.id, quantityValue, generatePickupCode()]
    );

    const reservation = reservationResult.rows[0];

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

    res.status(201).json({
      reservation,
      payment,
    });

  } catch (err) {
    await client.query("ROLLBACK");

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
    `SELECT r.*, f.provider_id
    FROM reservations r
    JOIN food_listings f ON r.listing_id = f.id
    WHERE r.id=$1
    FOR UPDATE`,
    [id],
  );

  if (!result.rows.length) return res.status(404).json({ error: "Not found" });

  res.json(result.rows[0]);
};

exports.getMyReservations = async (req, res) => {
  const result = await pool.query(
    `SELECT r.*, f.title, f.pickup_end_time
     FROM reservations r
     JOIN food_listings f ON r.listing_id = f.id
     WHERE r.user_id=$1
     ORDER BY r.reserved_at DESC`,
    [req.user.id],
  );

  res.json(result.rows);
};


exports.cancelReservation = async (req, res) => {
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
    if (reservation.status !== "reserved") {
      throw withStatus("Cannot cancel this reservation", 400);
    }

    if (reservation.task_status !== "pending") {
      throw withStatus("Cannot cancel after volunteer started", 400);
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

    if (reservation.pickup_code !== pickup_code)
      throw withStatus("Invalid pickup code", 400);

    if (
      reservation.pickup_type === "ngo" &&
      reservation.task_status !== "in_progress"
    )
      throw withStatus("Volunteer has not started pickup", 400);

    const update = await client.query(
      `
      UPDATE reservations
      SET task_status='picked_from_provider',
          picked_up_at = NOW()
      WHERE id=$1
      RETURNING *
      `,
      [id]
    );

    await client.query("COMMIT");

    if (reservation.pickup_type === "ngo") {
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
      message: "Pickup confirmed. Volunteer must deliver to NGO.",
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
