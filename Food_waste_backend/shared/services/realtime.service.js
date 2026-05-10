const pool = require("../config/db");
const redis = require("../config/redis");

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

async function publishSocketEvent(room, event, data) {
  try {
    await redis.publish(
      "socket_events",
      JSON.stringify({ room, event, data })
    );
  } catch (err) {
    console.warn("Realtime publish failed:", err.message);
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
    LEFT JOIN users requester ON requester.id = r.user_id
    LEFT JOIN users volunteer ON volunteer.id = r.assigned_volunteer_id
    WHERE r.id=$1
    `,
    [reservationId]
  );

  return result.rows[0] || null;
}

async function getListingSnapshot(listingId, client = pool) {
  const result = await client.query(
    `SELECT * FROM food_listings WHERE id=$1`,
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
    console.warn("Reservation realtime snapshot failed:", err.message);
    return null;
  }

  if (!reservation) return null;

  const payload = {
    action: options.action,
    reservation,
  };

  await publishToUsers(
    [
      reservation.user_id,
      reservation.provider_id,
      reservation.assigned_volunteer_id,
      ...(options.extraUserIds || []),
    ],
    "reservation_updated",
    payload
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
    console.warn("Payment realtime snapshot failed:", err.message);
    return null;
  }

  if (!reservation) return null;

  const payload = {
    action: options.action,
    payment,
    reservation,
  };

  await publishToUsers(
    [
      reservation.user_id,
      reservation.provider_id,
      reservation.assigned_volunteer_id,
      ...(options.extraUserIds || []),
    ],
    "payment_updated",
    payload
  );

  return payment;
}

async function publishVolunteerUpdated(reservationId, options = {}) {
  let reservation;

  try {
    reservation =
      options.reservation || (await getReservationSnapshot(reservationId, options.client));
  } catch (err) {
    console.warn("Volunteer realtime snapshot failed:", err.message);
    return null;
  }

  if (!reservation) return null;

  const payload = {
    action: options.action,
    reservation,
    volunteer: reservation.assigned_volunteer_id
      ? {
          id: reservation.assigned_volunteer_id,
          name: reservation.assigned_volunteer_name,
          phone: reservation.assigned_volunteer_phone,
        }
      : null,
  };

  await publishToUsers(
    [
      reservation.user_id,
      reservation.provider_id,
      reservation.assigned_volunteer_id,
      ...(options.extraUserIds || []),
    ],
    "volunteer_updated",
    payload
  );

  return reservation;
}

async function publishListingUpdated(listingId, options = {}) {
  let listing;

  try {
    listing =
      options.listing || (await getListingSnapshot(listingId, options.client));
  } catch (err) {
    console.warn("Listing realtime snapshot failed:", err.message);
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
  publishToUsers,
  publishVolunteerUpdated,
};
