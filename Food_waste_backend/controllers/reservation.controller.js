const pool = require("../shared/config/db");
const generatePickupCode = require("../utils/codeGenerator");
const notificationQueue = require("../queues/notification.queue");
const pickupQueue = require("../queues/pickup.queue");
const deliveryQueue = require("../queues/delivery.queue");
const refundQueue = require("../queues/refund.queue");
const paymentQueue = require("../queues/payment.queue");
const logger = require("../shared/utils/logger");

const {
  createReservationPayment,
  cancelPayment,
  refundReliabilityDeposit,
} = require("../shared/services/payment.service");
const {
  getTrustEnforcementPolicy,
  recordReservationLifecycleTrustEvents,
} = require("../shared/services/trustEnforcement.service");
const {
  reserveListingStock,
} = require("../shared/services/inventory.service");
const {
  lockReservationGraph,
  restoreReservationStockIfHeld,
} = require("../shared/services/reservationConsistency.service");
const {
  addProviderReportAttachments,
  applyProviderReportCooldown,
  createProviderReport,
} = require("../shared/services/moderation.service");
const {
  notifyAdminsProviderReportSubmitted,
  notifyProviderReportSubmittedAgainstProvider,
} = require("../shared/services/operationalNotification.service");
const {
  blockingReservationWhere,
  pendingPaymentReservationWhere,
} = require("../shared/services/reservationLock.service");
const {
  lifecycleSql,
} = require("../shared/services/reservationLifecycle.service");
const {
  prepareLifecycleAccounting,
} = require("../shared/services/lifecycleAccounting.service");
const { providerDisplaySelect } = require("../shared/services/providerDisplay.service");
const {
  ensureReservationPaymentContextSchema,
} = require("../shared/services/reservationPaymentContext.service");
const { recordReservationCreated } = require("../shared/services/metrics.service");
const {
  evaluateReservationSpamGuard,
} = require("../shared/services/abuseGuard.service");
const { jobOptions } = require("../shared/utils/queueOptions");
const { withTransaction } = require("../shared/utils/transaction");
const {
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
  publishVolunteerUpdated,
} = require("../shared/services/realtime.service");
const { isIntegerInRange, isProvided, isValidId, toNumber } = require("../utils/validation");

const withStatus = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const RESERVATION_EXISTS_MESSAGE = "User already has reservation for this listing.";

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
    logger.warn("Queue cleanup failed", { err, reservationId, orderId });
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

async function cancelPaymentInitializationHold(reservationId, reason) {
  return withTransaction(
    pool,
    async (client) => {
      const { reservation } = await lockReservationGraph(client, reservationId, {
        lockPayments: true,
      });

      if (
        !reservation ||
        reservation.status !== "payment_pending" ||
        reservation.payment_status !== "pending"
      ) {
        return null;
      }

      const restoredListing = await restoreReservationStockIfHeld(client, reservation, {
        reason,
      });

      await client.query(
        `
        UPDATE reservations
        SET status='payment_failed',
            payment_status='failed',
            payment_context=COALESCE(payment_context, '{}'::jsonb) ||
              jsonb_build_object('payment_initialization_failed_at', NOW())
        WHERE id=$1
        AND status='payment_pending'
        AND payment_status='pending'
        `,
        [reservation.id]
      );

      return {
        listingId: reservation.listing_id,
        restoredListing,
      };
    },
    {
      name: "payment_initialization_hold_cancel",
      maxAttempts: 4,
      lockTimeoutMs: 2500,
      statementTimeoutMs: 20000,
    }
  );
}

exports.createReservation = async (req, res) => {
  if (req.user.role !== "user")
    return res.status(403).json({ error: "Only users allowed" });

  const { listing_id, quantity } = req.body;
  const quantityValue = toNumber(quantity);

  if (!isValidId(listing_id)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  if (!isProvided(quantity) || !isIntegerInRange(quantityValue, 1, 2)) {
    return res.status(400).json({ error: "Quantity must be 1 or 2" });
  }

  try {
    if (quantityValue > 2) throw withStatus("Max 2 items allowed", 400);

    const hold = await withTransaction(
      pool,
      async (client) => {
        await ensureReservationPaymentContextSchema(client);
        const abuseGuard = await evaluateReservationSpamGuard(client, req.user.id);

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
          FOR UPDATE OF f
          `,
          [listing_id]
        );

        if (!foodResult.rows.length) throw withStatus("Listing not found", 404);

        const food = foodResult.rows[0];

        if (food.is_free) {
          throw withStatus("Free listings are only available for NGOs", 403);
        }

        if (Number(food.remaining_quantity) < quantityValue) {
          throw withStatus("Not enough quantity", 409);
        }

        if (String(food.status || "active") !== "active") {
          throw withStatus("Listing is not active", 409);
        }

        if (new Date(food.pickup_end_time).getTime() <= Date.now()) {
          throw withStatus("Listing pickup window has ended", 409);
        }

        await ensureListingNotPreviouslyReserved(client, req.user.id, listing_id);

        const foodAmount = Number(food.price) * quantityValue;
        const policy = await getTrustEnforcementPolicy({
          client,
          userId: req.user.id,
          role: req.user.role,
          foodCost: foodAmount,
        });

        if (!policy.canReserve) {
          throw withStatus(policy.restrictionReason || "Reservation restricted", 403);
        }

        await reserveListingStock(client, {
          listingId: listing_id,
          quantity: quantityValue,
        });

        const reservationResult = await client.query(
          `
          INSERT INTO reservations
          (listing_id, user_id, quantity_reserved, pickup_type, task_status, status, pickup_code, payment_status, payment_context)
          VALUES ($1,$2,$3,'self_pickup','self_pickup','payment_pending',$4,'pending',$5::jsonb)
          RETURNING *
          `,
          [
            listing_id,
            req.user.id,
            quantityValue,
            null,
            JSON.stringify({
              source: "user_reservation",
              stock_reserved: true,
              payment_initializing: true,
            }),
          ]
        );

        const reservation = reservationResult.rows[0];
        const depositAmount = policy.requiresDeposit ? policy.depositAmount : 0;

        return {
          reservation,
          foodAmount,
          depositAmount,
          policy,
          abuseGuard,
        };
      },
      {
        name: "user_reservation_stock_hold",
        maxAttempts: 4,
        lockTimeoutMs: 2500,
        statementTimeoutMs: 20000,
      }
    );

    logger.info("Inventory reserved for pending payment", {
      userId: req.user.id,
      listingId: listing_id,
      quantity: quantityValue,
      reservationId: hold.reservation.id,
    });

    await publishListingUpdated(listing_id, { action: "quantity_updated" }).catch(
      (err) => {
        logger.warn("Pending reservation listing update publish failed", {
          err,
          listingId: listing_id,
          reservationId: hold.reservation.id,
        });
      }
    );

    let responseReservation = hold.reservation;
    let payment;
    try {
      const paymentSession = await withTransaction(
        pool,
        async (client) => {
          const lockedReservation = await client.query(
            `
            SELECT *
            FROM reservations
            WHERE id=$1
            FOR UPDATE
            `,
            [hold.reservation.id]
          );
          const pendingReservation = lockedReservation.rows[0];

          if (
            !pendingReservation ||
            pendingReservation.status !== "payment_pending" ||
            pendingReservation.payment_status !== "pending"
          ) {
            throw withStatus("Reservation hold is no longer pending payment", 409);
          }

          const createdPayment = await createReservationPayment({
            client,
            user: req.user,
            reservations: [
              {
                ...pendingReservation,
                food_amount: hold.foodAmount,
                reliability_deposit_amount: hold.depositAmount,
              },
            ],
          });

          const updatedReservation = await client.query(
            `
            UPDATE reservations
            SET payment_context=COALESCE(payment_context, '{}'::jsonb) ||
              jsonb_build_object('payment_initializing', false, 'payment_initialized_at', NOW())
            WHERE id=$1
            AND status='payment_pending'
            AND payment_status='pending'
            RETURNING *
            `,
            [pendingReservation.id]
          );

          return {
            payment: createdPayment,
            reservation: updatedReservation.rows[0] || pendingReservation,
          };
        },
        {
          name: "user_reservation_payment_session",
          maxAttempts: 1,
          lockTimeoutMs: 2500,
          statementTimeoutMs: 30000,
        }
      );
      payment = paymentSession.payment;
      responseReservation = paymentSession.reservation;
    } catch (paymentErr) {
      try {
        const cleanup = await cancelPaymentInitializationHold(
          hold.reservation.id,
          "payment_initialization_failed"
        );

        if (cleanup?.listingId) {
          await publishListingUpdated(cleanup.listingId, {
            action: "quantity_updated",
          }).catch((publishErr) => {
            logger.warn("Payment initialization cleanup publish failed", {
              err: publishErr,
              listingId: cleanup.listingId,
              reservationId: hold.reservation.id,
            });
          });
        }
      } catch (cleanupErr) {
        logger.error("Payment initialization cleanup failed", {
          err: cleanupErr,
          reservationId: hold.reservation.id,
          listingId: listing_id,
        });
      }

      throw paymentErr;
    }

    recordReservationCreated({
      pickupType: responseReservation.pickup_type,
      paymentStatus: responseReservation.payment_status,
      source: "user_reservation",
    });
    logger.info("Reservation created", {
      reservationId: responseReservation.id,
      userId: req.user.id,
      listingId: listing_id,
      paymentStatus: responseReservation.payment_status,
    });

    await publishListingUpdated(listing_id, { action: "quantity_updated" }).catch(
      (err) => {
        logger.warn("Reservation listing update publish failed", {
          err,
          listingId: listing_id,
          reservationId: responseReservation.id,
        });
      }
    );

    res.status(201).json({
      reservation: responseReservation,
      payment,
      pricing: {
        foodAmount: hold.foodAmount,
        depositAmount: hold.depositAmount,
        totalAmount: hold.foodAmount + hold.depositAmount,
        requiresDeposit: hold.depositAmount > 0,
      },
      policy: {
        ...hold.policy,
        depositAmount: hold.depositAmount,
        requiresDeposit: hold.depositAmount > 0,
      },
    });
  } catch (err) {
    if (
      err.code === "23505" ||
      err.constraint === "unique_active_reservation" ||
      err.constraint === "unique_pending_payment_reservation"
    ) {
      return res.status(409).json({
        error: RESERVATION_EXISTS_MESSAGE,
      });
    }

    logger.warn("Reservation creation failed", {
      err,
      userId: req.user?.id,
      listingId: listing_id,
      reason: err.reason,
    });

    res.status(err.statusCode || 400).json({
      error: err.message || "Reservation failed",
    });
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
            p.food_amount,
            p.reliability_deposit_amount,
            p.reliability_deposit_status,
            CASE
              WHEN r.status='payment_pending'
              AND r.payment_status='pending'
              AND p.status='pending'
              AND r.user_id=$1
              THEN p.order_id
              ELSE NULL
            END AS order_id,
            CASE
              WHEN r.status='payment_pending'
              AND r.payment_status='pending'
              AND p.status='pending'
              AND r.user_id=$1
              THEN p.payment_session_id
              ELSE NULL
            END AS payment_session_id,
            ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
            restaurant.restaurant_name,
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
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id = f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    JOIN users requester ON requester.id = r.user_id
    LEFT JOIN users volunteer ON volunteer.id = r.assigned_volunteer_id
    LEFT JOIN ratings rating ON rating.reservation_id = r.id
    LEFT JOIN payments p ON p.reservation_id = r.id
    WHERE r.id=$1
    `,
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

  if (isProvider) {
    delete reservation.pickup_code;
    delete reservation.receive_code;
  } else if (isVolunteer) {
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
          p.food_amount,
          p.reliability_deposit_amount,
          p.reliability_deposit_status,
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
          ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
          restaurant.restaurant_name,
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
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id = f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    LEFT JOIN users requester ON requester.id = r.user_id
    LEFT JOIN users volunteer ON volunteer.id = r.assigned_volunteer_id
    LEFT JOIN payments p ON p.reservation_id = r.id
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
             r.payment_status,
             r.payment_expires_at,
             r.reserved_at,
             r.assigned_at,
             r.picked_up_at,
             r.completed_at,
             ${lifecycleSql("r")} AS lifecycle_group,
             f.id AS listing_id,
             f.title,
             f.description,
             f.pickup_start_time,
             f.pickup_end_time,
             f.is_free,
             f.price,
             p.food_amount,
             p.reliability_deposit_amount,
             p.reliability_deposit_status,
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
      LEFT JOIN payments p ON p.reservation_id = r.id
      WHERE f.provider_id = $1
      ORDER BY r.reserved_at DESC NULLS LAST, r.id DESC
      `,
      [req.user.id],
    );

    res.json(result.rows);
  } catch (err) {
    logger.error("Failed to fetch provider reservations", {
      err,
      userId: req.user?.id,
    });
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
  let committed = false;

  try {
    await client.query("BEGIN");

    /*
    ========================
    1️⃣ LOCK RESERVATION
    ========================
    */
    const locked = await lockReservationGraph(client, id, { lockPayments: true });
    const reservation = locked.reservation;

    if (!reservation) throw withStatus("Reservation not found", 404);

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
    await restoreReservationStockIfHeld(client, reservation, {
      reason: "legacy_reservation_cancelled",
    });

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
      logger.warn("Queue cleanup failed", { err, reservationId: id });
    }

    /*
    ========================
    🔟 REFUND (ONLY IF PAID)
    ========================
    */
    if (reservation.payment_status === "paid") {
      await refundQueue.add(
        "refund-payment",
        {
          reservationId: reservation.id,
          operationSource:
            reservation.pickup_type === "ngo" ? "ngo_cancelled" : "user_cancelled",
        },
        jobOptions("critical", {
          jobId: `refund-${reservation.id}`,
        })
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

    const locked = await lockReservationGraph(client, id, { lockPayments: true });
    let reservation = locked.reservation;
    let payment = locked.payment;

    if (!reservation) throw withStatus("Reservation not found", 404);

    if (reservation.user_id !== req.user.id) {
      throw withStatus("Unauthorized", 403);
    }

    if (reservation.status === "cancelled") {
      throw withStatus("Already cancelled", 409);
    }

    if (!["reserved", "payment_pending"].includes(reservation.status)) {
      throw withStatus("Cannot cancel this reservation", 400);
    }

    if (
      reservation.status === "payment_pending" &&
      reservation.payment_status === "pending" &&
      ["paid", "success"].includes(String(payment?.status || "").toLowerCase())
    ) {
      const repaired = await client.query(
        `
        UPDATE reservations
        SET status='reserved',
            payment_status='paid',
            pickup_code=COALESCE(pickup_code, $2),
            receive_code=COALESCE(receive_code, $3),
            payment_context=COALESCE(payment_context, '{}'::jsonb) ||
              jsonb_build_object('paid_recovered_at', NOW(), 'paid_recovery_source', 'cancel_race')
        WHERE id=$1
        AND status='payment_pending'
        AND payment_status='pending'
        RETURNING *
        `,
        [reservation.id, generatePickupCode(), generatePickupCode()]
      );
      if (repaired.rows.length) {
        reservation = {
          ...reservation,
          ...repaired.rows[0],
        };
        logger.payment("Recovered paid reservation during cancellation race", {
          reservationId: reservation.id,
          paymentId: payment?.id,
          orderId: payment?.order_id,
        });
      }
    }

    if (
      reservation.status === "payment_pending" &&
      reservation.payment_status === "pending"
    ) {
      paymentTimeoutOrderId = payment?.order_id || null;

      await cancelPayment(client, reservation.id);

      await restoreReservationStockIfHeld(client, reservation, {
        reason: "payment_cancelled_before_confirmation",
      });

      await client.query(
        `
        UPDATE reservations
        SET status='cancelled_before_confirmation',
            payment_status='failed',
            payment_context=COALESCE(payment_context, '{}'::jsonb) ||
              jsonb_build_object('cancelled_before_confirmation_at', NOW())
        WHERE id=$1
        AND status='payment_pending'
        AND payment_status='pending'
        `,
        [reservation.id]
      );

      if (payment) {
        await prepareLifecycleAccounting({
          client,
          reservation,
          payment,
          terminalReason: "payment_cancelled_before_confirmation",
          lifecycleState: {
            outcome: "payment_timeout",
            refundType: "none",
          },
          actorContext: {
            actorUserId: req.user.id,
            actorRole: req.user.role,
          },
          metadata: {
            controller: "reservation.cancelReservation",
          },
        });
      }

      await recordReservationLifecycleTrustEvents({
        client,
        reservationId: reservation.id,
      });

      await client.query("COMMIT");
      committed = true;

      await cleanupCancellationQueues(reservation.id, paymentTimeoutOrderId);
      await publishListingUpdated(reservation.listing_id, {
        action: "quantity_updated",
      });

      return res.json({
        message: "Payment was not completed. Reservation was not created.",
      });
    }

    if (reservation.pickup_type === "ngo") {
      if (reservation.task_status !== "pending") {
        throw withStatus("Cannot cancel after volunteer started", 400);
      }

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

        refundReservationId = reservation.id;
      }

      await restoreReservationStockIfHeld(client, reservation, {
        reason: "ngo_reservation_cancelled",
      });

      await client.query(
        `
        UPDATE reservations
        SET status='cancelled',
            payment_status = CASE
              WHEN payment_status='paid' THEN 'refund_pending'
              ELSE payment_status
            END
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

      await restoreReservationStockIfHeld(client, reservation, {
        reason: refundReservationId
          ? "paid_reservation_cancelled_for_refund"
          : "reservation_cancelled",
      });
    }

    await recordReservationLifecycleTrustEvents({
      client,
      reservationId: reservation.id,
    });

    cancelledReservation = reservation;
    await client.query("COMMIT");
    committed = true;

    await cleanupCancellationQueues(reservation.id, paymentTimeoutOrderId);

    if (refundReservationId) {
      try {
        await refundQueue.add(
          "refund-payment",
          {
            reservationId: refundReservationId,
            operationSource:
              reservation.pickup_type === "ngo" ? "ngo_cancelled" : "user_cancelled",
          },
          jobOptions("critical", {
            jobId: `refund-${refundReservationId}`,
          })
        );
      } catch (err) {
        logger.error("Failed to enqueue refund", { err, reservationId: refundReservationId });
      }
    }

    try {
      await notifyReservationCancelled(req, cancelledReservation);
    } catch (err) {
      logger.warn("Cancellation notification failed", { err, reservationId: reservation.id });
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
      FOR UPDATE OF r
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

    if (!["paid", "not_required"].includes(reservation.payment_status))
      throw withStatus("Reservation payment is not finalized", 409);

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
    const updatedReservation = {
      ...reservation,
      ...update.rows[0],
      provider_id: reservation.provider_id,
    };

    if (!isNGOPickup) {
      await recordReservationLifecycleTrustEvents({
        client,
        reservationId: updatedReservation.id,
      });
    }

    await client.query("COMMIT");

    await Promise.all([
      publishReservationUpdated(updatedReservation.id, {
        action: isNGOPickup ? "picked_from_provider" : "picked_up",
        reservation: updatedReservation,
        extraUserIds: [updatedReservation.user_id],
      }),
      publishVolunteerUpdated(updatedReservation.id, {
        action: isNGOPickup ? "pickup_confirmed" : "self_pickup_completed",
        reservation: updatedReservation,
      }),
      publishTaskAvailabilityUpdated(updatedReservation.id, {
        action: isNGOPickup ? "pickup_confirmed" : "unavailable",
        reservation: updatedReservation,
      }),
      isNGOPickup
        ? notificationQueue
            .add("notify-user", {
              userId: updatedReservation.user_id,
              type: "pickup_completed",
              title: "Food Picked Up",
              message: "Volunteer picked up food from provider.",
              data: {
                reservation_id: updatedReservation.id,
                listing_id: updatedReservation.listing_id,
                volunteer_id: updatedReservation.assigned_volunteer_id,
              },
            })
            .catch((err) => {
              logger.warn("NGO pickup completion notification failed", {
                err,
                reservationId: updatedReservation.id,
                ngoUserId: updatedReservation.user_id,
              });
            })
        : Promise.resolve(),
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
        { reservationId: updatedReservation.id },
        jobOptions("critical", {
          delay,
          jobId: `delivery-${updatedReservation.id}`,
        })
      );

      logger.info("Delivery timeout scheduled", { reservationId: id });
    } else {
      await refundReliabilityDeposit(refundQueue, updatedReservation.id, {
        operationSource: "successful_pickup",
      });
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

exports.previewReservation = async (req, res) => {
  if (req.user.role !== "user") {
    return res.status(403).json({ error: "Only users allowed" });
  }

  const { listing_id, quantity } = req.body;
  const quantityValue = toNumber(quantity);

  if (!isValidId(listing_id)) {
    return res.status(400).json({ error: "Listing id is required" });
  }

  if (!isProvided(quantity) || !isIntegerInRange(quantityValue, 1, 2)) {
    return res.status(400).json({ error: "Quantity must be 1 or 2" });
  }

  try {
    const foodResult = await pool.query(
      `
      SELECT f.id, f.price, f.is_free, f.remaining_quantity, f.status, f.pickup_end_time
      FROM food_listings f
      WHERE f.id=$1
      AND EXISTS (
        SELECT 1
        FROM restaurants approved_restaurant
        WHERE approved_restaurant.user_id=f.provider_id
        AND approved_restaurant.is_verified=true
      )
      `,
      [listing_id]
    );

    if (!foodResult.rows.length) {
      return res.status(404).json({ error: "Listing not found" });
    }

    const food = foodResult.rows[0];

    if (food.is_free) {
      return res.status(403).json({ error: "Free listings are only available for NGOs" });
    }

    if (String(food.status || "active") !== "active") {
      return res.status(409).json({ error: "Listing is not active" });
    }

    if (new Date(food.pickup_end_time).getTime() <= Date.now()) {
      return res.status(409).json({ error: "Listing pickup window has ended" });
    }

    if (toNumber(food.remaining_quantity) < quantityValue) {
      return res.status(409).json({ error: "Not enough quantity" });
    }

    const foodAmount = Number(food.price) * quantityValue;
    const policy = await getTrustEnforcementPolicy({
      userId: req.user.id,
      role: req.user.role,
      foodCost: foodAmount,
    });
    const depositAmount = policy.requiresDeposit ? Number(policy.depositAmount || 0) : 0;

    res.json({
      foodAmount,
      depositAmount,
      totalAmount: foodAmount + depositAmount,
      requiresDeposit: depositAmount > 0,
      policy: {
        ...policy,
        depositAmount,
        requiresDeposit: depositAmount > 0,
      },
    });
  } catch (err) {
    logger.error("Reservation preview failed", { err, userId: req.user?.id, listingId: listing_id });
    res.status(500).json({ error: "Reservation preview failed" });
  }
};

exports.reportProvider = async (req, res) => {
  const { id } = req.params;
  const { reason, description } = req.body;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Reservation id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reservationResult = await client.query(
      `
      SELECT r.id, r.user_id, r.pickup_type, f.provider_id
      FROM reservations r
      JOIN food_listings f ON f.id = r.listing_id
      WHERE r.id=$1
      FOR UPDATE OF r
      `,
      [id]
    );

    if (!reservationResult.rows.length) throw withStatus("Reservation not found", 404);

    const reservation = reservationResult.rows[0];

    if (!["user", "ngo"].includes(req.user.role)) {
      throw withStatus("Only users and NGOs can report providers", 403);
    }

    if (String(reservation.user_id) !== String(req.user.id)) {
      throw withStatus("Only the requester can report this provider", 403);
    }

    const report = await createProviderReport({
      client,
      providerId: reservation.provider_id,
      reportedBy: req.user.id,
      reservationId: reservation.id,
      reason,
      description,
      applyCooldown: false,
    });
    const attachments = await addProviderReportAttachments({
      client,
      reportId: report.id,
      uploaderUserId: req.user.id,
      files: req.files || [],
    });

    await client.query("COMMIT");
    committed = true;
    await applyProviderReportCooldown({ reportedBy: req.user.id }).catch((err) => {
      logger.error("Failed to apply provider report cooldown", {
        err,
        reportedBy: req.user?.id,
        reportId: report.id,
      });
    });
    void notifyAdminsProviderReportSubmitted({
      reportId: report.id,
      caseId: report.moderation_case_id,
      providerId: report.provider_id,
      reporterId: req.user.id,
    });
    void notifyProviderReportSubmittedAgainstProvider({
      providerId: report.provider_id,
      reportId: report.id,
      caseId: report.moderation_case_id,
    });

    res.status(201).json({
      message: "Provider report submitted for moderation.",
      report: {
        ...report,
        attachments,
      },
    });
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    if (err.retryAfter) {
      res.set("Retry-After", String(err.retryAfter));
    }
    res.status(err.statusCode || 400).json({
      error: err.message,
      retryAfter: err.retryAfter,
    });
  } finally {
    client.release();
  }
};
