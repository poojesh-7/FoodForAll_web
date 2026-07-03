const logger = require("../utils/logger");
const { restoreListingStock } = require("./inventory.service");
const { hasReservedStock } = require("./reservationPaymentContext.service");
const {
  prepareLifecycleAccounting,
} = require("./lifecycleAccounting.service");
const {
  recordReservationLifecycleTrustEvents,
} = require("./trustEnforcement.service");

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

async function releasePendingPaymentReservation(
  client,
  reservationId,
  options = {}
) {
  const paymentStatus = options.paymentStatus || "failed";
  const reservationStatus =
    options.reservationStatus ||
    (paymentStatus === "expired" ? "expired_payment" : "payment_failed");
  const reason = options.reason || `payment_${paymentStatus}`;
  const terminalReason = options.terminalReason || "payment_timeout";
  const terminalSource =
    options.terminalSource || options.source || "pending_payment_release";
  const actorContext = options.actorContext || { role: "system" };
  const lifecycleState = options.lifecycleState || {
    outcome: "payment_timeout",
    refundType: "none",
  };

  const { reservation, payments, payment } = await lockReservationGraph(
    client,
    reservationId,
    { lockPayments: true }
  );

  if (!reservation) {
    return { released: false, reason: "reservation_not_found" };
  }

  if (
    reservation.status !== "payment_pending" ||
    reservation.payment_status !== "pending"
  ) {
    return {
      released: false,
      reason: "reservation_not_pending_payment",
      reservation,
      payment,
    };
  }

  const terminalPayment = payments.find((row) =>
    ["paid", "success", "refund_pending", "refunded"].includes(
      String(row?.status || "").toLowerCase()
    )
  );

  if (terminalPayment) {
    logger.payment("Skipped pending payment release because payment is terminal", {
      reservationId,
      paymentId: terminalPayment.id,
      paymentStatus: terminalPayment.status,
      reason,
    });
    return {
      released: false,
      reason: "payment_already_terminal",
      reservation,
      payment: terminalPayment,
    };
  }

  const restoredListing = await restoreReservationStockIfHeld(client, reservation, {
    reason,
    reactivateIfAvailable: options.reactivateIfAvailable,
  });

  // 🔒 STATE MACHINE ATOMIC UPDATE - Payment Status Transition
  // Both payment and reservation MUST transition together.
  // If either update fails to match its WHERE clause, the transaction fails.

  const paymentUpdateResult = await client.query(
    `
    UPDATE payments
    SET status=$2,
        gateway_status=COALESCE($3, gateway_status),
        reconciliation_status=COALESCE($4, reconciliation_status),
        last_reconciled_at=NOW(),
        updated_at=NOW()
    WHERE reservation_id=$1
    AND status='pending'
    RETURNING id, status
    `,
    [
      reservation.id,
      paymentStatus,
      options.gatewayStatus || paymentStatus,
      options.reconciliationStatus || "terminal",
    ]
  );

  // CRITICAL: Validate payment state transitioned
  if (!paymentUpdateResult.rows.length) {
    throw new Error(
      `Payment state machine violated: Payment for reservation ${reservation.id} ` +
      `is not in 'pending' status. Cannot transition to '${paymentStatus}'. ` +
      `Current state is unknown (likely already transitioned by concurrent operation). ` +
      `This indicates a state machine race condition.`
    );
  }

  const releasedReservation = await client.query(
    `
    UPDATE reservations
    SET status=$2,
        payment_status=$3,
        payment_context=COALESCE(payment_context, '{}'::jsonb) ||
          jsonb_build_object(
            'payment_terminal_at', NOW(),
            'payment_terminal_source', $4::text,
            'payment_release_reason', $5::text
          ) ||
          $6::jsonb
    WHERE id=$1
    AND status='payment_pending'
    AND payment_status='pending'
    RETURNING *
    `,
    [
      reservation.id,
      reservationStatus,
      paymentStatus,
      terminalSource,
      reason,
      JSON.stringify(options.paymentContext || {}),
    ]
  );

  // CRITICAL: Validate reservation state transitioned
  if (!releasedReservation.rows.length) {
    throw new Error(
      `Payment state machine violated: Reservation ${reservation.id} ` +
      `is not in (payment_pending, pending) status. Payment was transitioned to '${paymentStatus}' ` +
      `but reservation update failed. Expected reservation to be in state (payment_pending, pending) ` +
      `but it is in state (${reservation.status}, ${reservation.payment_status}). ` +
      `This indicates a concurrent state transition that broke atomicity.`
    );
  }

  const updatedReservation = releasedReservation.rows[0];

  if (payment) {
    await prepareLifecycleAccounting({
      client,
      reservation,
      payment,
      terminalReason,
      lifecycleState,
      actorContext,
      metadata: {
        service: "reservationConsistency.releasePendingPaymentReservation",
        source: terminalSource,
        ...(options.metadata || {}),
      },
    });
  }

  await recordReservationLifecycleTrustEvents({
    client,
    reservationId: reservation.id,
  });

  logger.info("Pending payment reservation released", {
    reservationId: reservation.id,
    listingId: reservation.listing_id,
    paymentStatus,
    reservationStatus,
    reason,
    stockRestored: Boolean(restoredListing),
  });

  return {
    released: true,
    reservation: updatedReservation,
    previousReservation: reservation,
    payment,
    listingId: reservation.listing_id,
    restoredListing,
    stockRestored: Boolean(restoredListing),
  };
}

module.exports = {
  lockListingById,
  lockPaymentById,
  lockPaymentGraphByOrderId,
  lockPaymentsByReservationId,
  lockReservationGraph,
  releasePendingPaymentReservation,
  restoreReservationStockIfHeld,
};
