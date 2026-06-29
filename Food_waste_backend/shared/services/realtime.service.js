const pool = require("../config/db");
const redis = require("../config/redis");
const logger = require("../utils/logger");
const { providerDisplaySelect } = require("./providerDisplay.service");

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function withoutKeys(row, keys) {
  if (!row) return row;
  const copy = { ...row };
  keys.forEach((key) => {
    delete copy[key];
  });
  return copy;
}

function safeReservationState(reservation) {
  if (!reservation) return null;
  return {
    id: reservation.id,
    reservation_id: reservation.id,
    status: reservation.status,
    task_status: reservation.task_status,
    assigned_volunteer_id: reservation.assigned_volunteer_id,
  };
}

function sanitizePaymentForUser(payment) {
  if (!payment) return null;

  return {
    id: payment.id,
    reservation_id: payment.reservation_id,
    order_id: payment.order_id,
    amount: payment.amount,
    status: payment.status,
    refund_status: payment.refund_status,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
}

function sanitizeReservationForUser(reservation, userId) {
  if (!reservation) return reservation;
  const baseReservation = withoutKeys(reservation, ["requester_role"]);
  const isRequester = String(reservation.user_id) === String(userId);
  const isProvider = String(reservation.provider_id) === String(userId);
  const isVolunteer =
    reservation.assigned_volunteer_id !== undefined &&
    reservation.assigned_volunteer_id !== null &&
    String(reservation.assigned_volunteer_id) === String(userId);

  if (isProvider) {
    return withoutKeys(baseReservation, ["pickup_code", "receive_code"]);
  }

  if (isVolunteer) {
    return withoutKeys(baseReservation, ["receive_code"]);
  }

  if (isRequester && reservation.requester_role === "ngo") {
    return withoutKeys(baseReservation, ["pickup_code"]);
  }

  if (isRequester) {
    return withoutKeys(baseReservation, ["receive_code"]);
  }

  return withoutKeys(baseReservation, ["pickup_code", "receive_code"]);
}

async function publishSocketEvent(room, event, data, options = {}) {
  try {
    await redis.publish(
      "socket_events",
      JSON.stringify({ room, event, data })
    );
  } catch (err) {
    logger.warn("Realtime publish failed", { err, event, room });
    if (options.throwOnError) {
      throw err;
    }
  }
}

async function publishToUsers(userIds, event, data) {
  await Promise.all(
    unique(userIds).map((userId) =>
      publishSocketEvent(`user:${userId}`, event, data)
    )
  );
}

async function publishBroadcast(event, data) {
  await publishSocketEvent(undefined, event, data);
}

async function getReservationSnapshot(reservationId, client = pool) {
  const result = await client.query(
    `
    SELECT r.*,
           f.provider_id,
           f.title,
           f.description,
           f.pickup_start_time,
           f.pickup_end_time,
           f.is_free,
           f.price,
           f.quantity_unit,
           f.custom_quantity_unit,
           requester.id AS requester_id,
           CASE
             WHEN r.pickup_type = 'ngo'
             THEN COALESCE(
               NULLIF(TRIM(requester_ngo.organization_name), ''),
               requester.name
             )
             ELSE requester.name
           END AS requester_name,
           requester_ngo.organization_name AS requester_organization_name,
           requester.phone AS requester_phone,
           requester.role AS requester_role,
           volunteer.name AS assigned_volunteer_name,
           volunteer.phone AS assigned_volunteer_phone,
           CASE
             WHEN r.pickup_type = 'ngo' THEN 'ngo'
             ELSE 'self_pickup'
           END AS reservation_kind
    FROM reservations r
    JOIN food_listings f ON f.id = r.listing_id
    LEFT JOIN users requester ON requester.id = r.user_id
    LEFT JOIN ngos requester_ngo ON requester_ngo.user_id = requester.id
    LEFT JOIN users volunteer ON volunteer.id = r.assigned_volunteer_id
    WHERE r.id=$1
    `,
    [reservationId]
  );

  return result.rows[0] || null;
}

async function getListingSnapshot(listingId, client = pool) {
  const result = await client.query(
    `
    SELECT f.*,
           ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
           restaurant.restaurant_name
    FROM food_listings f
    JOIN users provider ON provider.id=f.provider_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id=f.provider_id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    WHERE f.id=$1
    `,
    [listingId]
  );

  return result.rows[0] || null;
}

async function getPaymentSnapshot(reservationId, client = pool) {
  const result = await client.query(
    `
    SELECT *
    FROM payments
    WHERE reservation_id=$1
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [reservationId]
  );

  return result.rows[0] || null;
}

async function publishReservationUpdated(reservationId, options = {}) {
  let reservation;

  try {
    reservation =
      options.reservation || (await getReservationSnapshot(reservationId, options.client));
  } catch (err) {
    logger.warn("Reservation realtime snapshot failed", { err, reservationId });
    return null;
  }

  if (!reservation) return null;

  const userIds = unique([
    reservation.user_id,
    reservation.provider_id,
    reservation.assigned_volunteer_id,
    ...(options.extraUserIds || []),
  ]);

  await Promise.all(
    userIds.map((userId) =>
      publishSocketEvent(`user:${userId}`, "reservation_updated", {
        action: options.action,
        reservation: sanitizeReservationForUser(reservation, userId),
      })
    )
  );

  return reservation;
}

async function publishPaymentUpdated(reservationId, options = {}) {
  let reservation;
  let payment;

  try {
    reservation =
      options.reservation || (await getReservationSnapshot(reservationId, options.client));
    payment =
      options.payment || (await getPaymentSnapshot(reservationId, options.client));
  } catch (err) {
    logger.warn("Payment realtime snapshot failed", { err, reservationId });
    return null;
  }

  if (!reservation) return null;

  const userIds = unique([
    reservation.user_id,
    reservation.provider_id,
    reservation.assigned_volunteer_id,
    ...(options.extraUserIds || []),
  ]);

  await Promise.all(
    userIds.map((userId) =>
      publishSocketEvent(`user:${userId}`, "payment_updated", {
        action: options.action,
        payment: sanitizePaymentForUser(payment),
        reservation: sanitizeReservationForUser(reservation, userId),
      })
    )
  );

  return payment;
}

async function publishVolunteerUpdated(reservationId, options = {}) {
  let reservation;

  try {
    reservation =
      options.reservation || (await getReservationSnapshot(reservationId, options.client));
  } catch (err) {
    logger.warn("Volunteer realtime snapshot failed", { err, reservationId });
    return null;
  }

  if (!reservation) return null;

  const userIds = unique([
    reservation.user_id,
    reservation.provider_id,
    reservation.assigned_volunteer_id,
    ...(options.extraUserIds || []),
  ]);

  await Promise.all(
    userIds.map((userId) =>
      publishSocketEvent(`user:${userId}`, "volunteer_updated", {
        action: options.action,
        reservation: sanitizeReservationForUser(reservation, userId),
        volunteer: reservation.assigned_volunteer_id
          ? {
              id: reservation.assigned_volunteer_id,
              name: reservation.assigned_volunteer_name,
              phone: reservation.assigned_volunteer_phone,
            }
          : null,
      })
    )
  );

  return reservation;
}

async function publishTaskAvailabilityUpdated(reservationId, options = {}) {
  let reservation;

  try {
    reservation =
      options.reservation || (await getReservationSnapshot(reservationId, options.client));
  } catch (err) {
    logger.warn("Task availability realtime snapshot failed", { err, reservationId });
    return null;
  }

  if (!reservation || reservation.pickup_type !== "ngo") return reservation;

  let volunteers = [];
  try {
    const result = await (options.client || pool).query(
      `
      SELECT v.user_id
      FROM volunteers v
      JOIN ngos n ON n.id = v.ngo_id
      WHERE n.user_id=$1
      AND v.status='active'
      `,
      [reservation.user_id]
    );
    volunteers = result.rows.map((row) => row.user_id);
  } catch (err) {
    logger.warn("Task availability volunteer lookup failed", { err, reservationId });
    return reservation;
  }

  const payload = {
    action: options.action,
    reservation: safeReservationState(reservation),
  };

  await Promise.all(
    unique(volunteers).flatMap((userId) => {
      const events = [
        publishSocketEvent(`user:${userId}`, "reservation_updated", payload),
      ];

      if (options.action === "task_claimed") {
        events.push(publishSocketEvent(`user:${userId}`, "task_claimed", payload));
      }

      return events;
    })
  );

  return reservation;
}

async function publishListingUpdated(listingId, options = {}) {
  let listing;

  try {
    listing = await getListingSnapshot(listingId, options.client);
    if (options.listing) {
      listing = listing ? { ...listing, ...options.listing } : options.listing;
    }
  } catch (err) {
    logger.warn("Listing realtime snapshot failed", { err, listingId });
    return null;
  }

  if (!listing) return null;

  const payload = {
    action: options.action,
    listing,
  };

  await Promise.all([
    publishBroadcast("listing_updated", payload),
    publishToUsers([listing.provider_id, ...(options.extraUserIds || [])], "listing_updated", payload),
  ]);

  return listing;
}

module.exports = {
  getListingSnapshot,
  getPaymentSnapshot,
  getReservationSnapshot,
  publishBroadcast,
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
  publishSocketEvent,
  publishTaskAvailabilityUpdated,
  publishToUsers,
  publishVolunteerUpdated,
};
