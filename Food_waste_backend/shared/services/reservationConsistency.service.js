const logger = require("../utils/logger");
const { restoreListingStock } = require("./inventory.service");
const { hasReservedStock } = require("./reservationPaymentContext.service");

function uniqueSorted(values) {
  return [
    ...new Set(
      values
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value))
    ),
  ].sort();
}

async function lockListingById(client, listingId) {
  if (!listingId) return null;

  const result = await client.query(
    `
    SELECT *
    FROM food_listings
    WHERE id=$1
    FOR UPDATE
    `,
    [listingId]
  );

  return result.rows[0] || null;
}

async function lockListingsByIds(client, listingIds) {
  const listingsById = new Map();

  for (const listingId of uniqueSorted(listingIds)) {
    const listing = await lockListingById(client, listingId);
    if (listing) listingsById.set(String(listing.id), listing);
  }

  return listingsById;
}

async function lockReservationById(client, reservationId) {
  if (!reservationId) return null;

  const result = await client.query(
    `
    SELECT r.*, f.provider_id, f.pickup_end_time, f.is_free
    FROM reservations r
    JOIN food_listings f ON f.id=r.listing_id
    WHERE r.id=$1
    FOR UPDATE OF r
    `,
    [reservationId]
  );

  return result.rows[0] || null;
}

async function lockReservationsByIds(client, reservationIds) {
  const reservationsById = new Map();

  for (const reservationId of uniqueSorted(reservationIds)) {
    const reservation = await lockReservationById(client, reservationId);
    if (reservation) reservationsById.set(String(reservation.id), reservation);
  }

  return reservationsById;
}

async function lockPaymentById(client, paymentId) {
  if (!paymentId) return null;

  const result = await client.query(
    `
    SELECT *
    FROM payments
    WHERE id=$1
    FOR UPDATE
    `,
    [paymentId]
  );

  return result.rows[0] || null;
}

async function lockPaymentsByIds(client, paymentIds) {
  const payments = [];

  for (const paymentId of uniqueSorted(paymentIds)) {
    const payment = await lockPaymentById(client, paymentId);
    if (payment) payments.push(payment);
  }

  return payments;
}

async function lockPaymentsByReservationId(client, reservationId) {
  const refs = await client.query(
    `
    SELECT id
    FROM payments
    WHERE reservation_id=$1
    ORDER BY created_at NULLS LAST, id
    `,
    [reservationId]
  );

  return lockPaymentsByIds(
    client,
    refs.rows.map((row) => row.id)
  );
}

async function getReservationLockRef(client, reservationId) {
  const result = await client.query(
    `
    SELECT id, listing_id
    FROM reservations
    WHERE id=$1
    `,
    [reservationId]
  );

  return result.rows[0] || null;
}

async function lockReservationGraph(client, reservationId, options = {}) {
  const { lockPayments = true } = options;
  const ref = await getReservationLockRef(client, reservationId);

  if (!ref) {
    return {
      listing: null,
      reservation: null,
      payments: [],
      payment: null,
    };
  }

  const listing = await lockListingById(client, ref.listing_id);
  const reservation = await lockReservationById(client, ref.id);
  const payments = lockPayments
    ? await lockPaymentsByReservationId(client, ref.id)
    : [];

  return {
    listing,
    reservation,
    payments,
    payment: payments[0] || null,
  };
}

async function lockPaymentGraphByOrderId(client, orderId) {
  const refs = await client.query(
    `
    SELECT p.id AS payment_id,
           p.reservation_id,
           r.listing_id
    FROM payments p
    LEFT JOIN reservations r ON r.id=p.reservation_id
    WHERE p.order_id=$1
    ORDER BY r.listing_id NULLS LAST,
             p.reservation_id NULLS LAST,
             p.id
    `,
    [orderId]
  );

  await lockListingsByIds(
    client,
    refs.rows.map((row) => row.listing_id)
  );

  const reservationsById = await lockReservationsByIds(
    client,
    refs.rows.map((row) => row.reservation_id)
  );

  const payments = await lockPaymentsByIds(
    client,
    refs.rows.map((row) => row.payment_id)
  );

  return {
    payments,
    reservationsById,
  };
}

async function restoreReservationStockIfHeld(
  client,
  reservation,
  options = {}
) {
  if (!reservation || !hasReservedStock(reservation)) return null;

  const reason = options.reason || "reservation_state_transition";
  const marked = await client.query(
    `
    UPDATE reservations
    SET payment_context =
      COALESCE(payment_context, '{}'::jsonb) ||
      jsonb_build_object(
        'stock_reserved', false,
        'stock_restored_at', NOW(),
        'stock_restore_reason', $2::text
      )
    WHERE id=$1
    AND COALESCE(payment_context->>'stock_reserved', 'true') <> 'false'
    RETURNING id
    `,
    [reservation.id, reason]
  );

  if (!marked.rows.length) {
    logger.info("Reservation stock restoration skipped as already restored", {
      reservationId: reservation.id,
      listingId: reservation.listing_id,
      reason,
    });
    return null;
  }

  const listing = await restoreListingStock(client, {
    listingId: reservation.listing_id,
    quantity: reservation.quantity_reserved,
    reactivateIfAvailable: options.reactivateIfAvailable !== false,
  });

  logger.info("Reservation stock restored", {
    reservationId: reservation.id,
    listingId: reservation.listing_id,
    quantity: reservation.quantity_reserved,
    reason,
  });

  return listing;
}

module.exports = {
  lockListingById,
  lockPaymentById,
  lockPaymentGraphByOrderId,
  lockPaymentsByReservationId,
  lockReservationGraph,
  restoreReservationStockIfHeld,
};
