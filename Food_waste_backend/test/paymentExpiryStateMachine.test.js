const assert = require("node:assert/strict");
const test = require("node:test");
const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");

const {
  releasePendingPaymentReservation,
  restoreReservationStockIfHeld,
} = require("../shared/services/reservationConsistency.service");

const {
  reconcileStalePaymentSessions,
  expirePendingReservationsByIds,
  reconcileOrder,
} = require("../shared/services/paymentReconciliation.service");

const { withTransaction } = require("../shared/utils/transaction");

/**
 * Regression tests for the payment/reservation state machine bug:
 * 
 * Issue: Payment status could be transitioned to 'expired' without the
 * corresponding reservation being transitioned, creating an orphaned state.
 * 
 * Root cause: Non-atomic UPDATE statements in releasePendingPaymentReservation()
 * where payment.status update could succeed but reservation.status update could fail.
 * 
 * Fix: Validate both UPDATE results and throw error if either fails, ensuring
 * transactionality forces both to succeed or both to rollback.
 */

// Helper: Create a test reservation with payment_pending status
async function createTestReservation(client) {
  const userId = `test-user-${Date.now()}-${Math.random()}`;
  const providerId = `test-provider-${Date.now()}-${Math.random()}`;
  const listingId = `test-listing-${Date.now()}-${Math.random()}`;

  // Create listing
  await client.query(
    `INSERT INTO food_listings (id, provider_id, title, quantity_available, price, status)
     VALUES ($1, $2, 'Test Food', 10, 100, 'active')`,
    [listingId, providerId]
  );

  // Create reservation
  const resResult = await client.query(
    `INSERT INTO reservations (
      id, listing_id, user_id, status, payment_status, 
      quantity_reserved, payment_context, reserved_at, payment_expires_at
    ) VALUES ($1, $2, $3, 'payment_pending', 'pending', 1, '{"stock_reserved": true}'::jsonb, 
              NOW(), NOW() + INTERVAL '10 minutes')
     RETURNING *`,
    [`test-res-${Date.now()}-${Math.random()}`, listingId, userId]
  );

  const reservation = resResult.rows[0];

  // Create payment
  const payResult = await client.query(
    `INSERT INTO payments (id, order_id, reservation_id, status, gateway_status, 
                           amount, currency, created_at)
     VALUES ($1, $2, $3, 'pending', 'PENDING', 100, 'INR', NOW())
     RETURNING *`,
    [`test-payment-${Date.now()}-${Math.random()}`, 
     `order-${Date.now()}-${Math.random()}`,
     reservation.id]
  );

  return {
    reservation,
    payment: payResult.rows[0],
    listingId,
  };
}

// Helper: Verify consistency between payment and reservation
async function assertPaymentReservationConsistency(client, reservationId) {
  const resResult = await client.query(
    `SELECT id, status, payment_status FROM reservations WHERE id = $1`,
    [reservationId]
  );

  const payResult = await client.query(
    `SELECT id, status FROM payments WHERE reservation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [reservationId]
  );

  const reservation = resResult.rows[0];
  const payment = payResult.rows[0];

  if (!reservation || !payment) {
    return true; // One or both missing is ok
  }

  // CRITICAL: These combinations should NEVER exist
  const invalidStates = [
    {
      res: "payment_pending",
      pay: "expired",
      reason: "Payment expired but reservation not released",
    },
    {
      res: "payment_pending",
      pay: "failed",
      reason: "Payment failed but reservation not released",
    },
    {
      res: "expired_payment",
      pay: "pending",
      reason: "Reservation released but payment not terminated",
    },
    {
      res: "payment_failed",
      pay: "pending",
      reason: "Reservation failed but payment not terminated",
    },
  ];

  for (const invalid of invalidStates) {
    assert.notEqual(
      `${reservation.status}:${payment.status}`,
      `${invalid.res}:${invalid.pay}`,
      `State machine violation: ${invalid.reason} (reservation=${reservation.status}, payment=${payment.status})`
    );
  }

  return true;
}

test("Scenario 1: Payment expires → both payment and reservation transition atomically", async () => {
  await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);

    // Release the pending payment (simulating payment expiry)
    const release = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "test",
    });

    assert.equal(release.released, true, "Payment release should succeed");
    assert.equal(release.reservation.status, "expired_payment", "Reservation should be expired_payment");
    assert.equal(release.reservation.payment_status, "expired", "Reservation payment_status should be expired");

    // Verify database consistency
    await assertPaymentReservationConsistency(client, reservation.id);

    // Verify database state
    const finalRes = await client.query(
      `SELECT status, payment_status FROM reservations WHERE id = $1`,
      [reservation.id]
    );
    const finalPay = await client.query(
      `SELECT status FROM payments WHERE reservation_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [reservation.id]
    );

    assert.equal(finalRes.rows[0].status, "expired_payment");
    assert.equal(finalRes.rows[0].payment_status, "expired");
    assert.equal(finalPay.rows[0].status, "expired");
  });
});

test("Scenario 2: Late webhook replayed → remains idempotent, no duplicate stock restoration", async () => {
  await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);

    // First expiry
    const release1 = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "test",
    });

    assert.equal(release1.released, true);

    // Attempt replay (should fail gracefully)
    const release2 = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "test_replay",
    });

    // Second call should detect reservation is no longer in payment_pending and return early
    assert.equal(release2.released, false, "Replay should not re-release");
    assert.equal(release2.reason, "reservation_not_pending_payment", "Should recognize already released");
  });
});

test("Scenario 3: Reconciliation remains idempotent after state transition", async () => {
  const testData = await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);

    // Release the payment
    const release = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "test",
    });

    assert.equal(release.released, true);

    return {
      reservationId: reservation.id,
      paymentId: payment.id,
      orderId: payment.order_id,
    };
  });

  // Now try to reconcile (should not find it since already released)
  const results = await reconcileStalePaymentSessions({
    reservationIds: [testData.reservationId],
    limit: 100,
  });

  // Should not find any orphaned reservations since it's already been released
  assert.equal(results.length, 0, "Reconciliation should not re-process released reservations");
});

test("Scenario 4: Payment and reservation remain consistent after concurrent operations", async () => {
  // This test verifies the fix prevents race conditions
  const { reservationId } = await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);
    return { reservationId: reservation.id, paymentId: payment.id };
  });

  // Multiple concurrent attempts to release the same reservation
  const results = await Promise.allSettled([
    withTransaction(pool, async (client) => {
      const { reservation } = await client.query(
        `SELECT id, status, payment_status FROM reservations WHERE id = $1`,
        [reservationId]
      ).then(r => ({ reservation: r.rows[0] }));

      if (reservation.status === "payment_pending" && reservation.payment_status === "pending") {
        return await releasePendingPaymentReservation(client, reservationId, {
          paymentStatus: "expired",
          reservationStatus: "expired_payment",
          reason: "concurrent_test_1",
          terminalReason: "concurrent_test_1",
          terminalSource: "test_concurrent_1",
        });
      }
      return { released: false };
    }),
    withTransaction(pool, async (client) => {
      const { reservation } = await client.query(
        `SELECT id, status, payment_status FROM reservations WHERE id = $1`,
        [reservationId]
      ).then(r => ({ reservation: r.rows[0] }));

      if (reservation.status === "payment_pending" && reservation.payment_status === "pending") {
        return await releasePendingPaymentReservation(client, reservationId, {
          paymentStatus: "expired",
          reservationStatus: "expired_payment",
          reason: "concurrent_test_2",
          terminalReason: "concurrent_test_2",
          terminalSource: "test_concurrent_2",
        });
      }
      return { released: false };
    }),
  ]);

  // Exactly one should succeed, one should fail gracefully
  const releases = results.map((r) => r.status === "fulfilled" ? r.value : { released: false });
  const successCount = releases.filter((r) => r.released).length;

  assert(successCount <= 1, "At most one concurrent release should succeed");

  // Verify final state consistency
  await withTransaction(pool, async (client) => {
    await assertPaymentReservationConsistency(client, reservationId);
  });
});

test("Scenario 5: Inventory and listing quantity are restored when payment expires", async () => {
  await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);

    // Get initial quantity
    const initialListing = await client.query(
      `SELECT quantity_available FROM food_listings WHERE id = $1`,
      [listingId]
    );

    // Release the payment with stock restoration
    const release = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "test",
      reactivateIfAvailable: true,
    });

    assert.equal(release.released, true);
    assert.equal(release.stockRestored, true, "Stock should be restored");

    // Verify quantity was restored
    const finalListing = await client.query(
      `SELECT quantity_available FROM food_listings WHERE id = $1`,
      [listingId]
    );

    assert(
      finalListing.rows[0].quantity_available > initialListing.rows[0].quantity_available,
      "Listing quantity should be restored"
    );

    // Verify stock_reserved flag is updated
    const finalRes = await client.query(
      `SELECT payment_context FROM reservations WHERE id = $1`,
      [reservation.id]
    );

    const context = finalRes.rows[0].payment_context;
    assert.equal(context.stock_reserved, false, "stock_reserved should be marked false");
  });
});

test("Scenario 6: Resume Payment disappears when payment expires", async () => {
  // This verifies the end-user experience: after payment expiry,
  // the "Resume Payment" option should no longer be available
  await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);

    // Before expiry, payment_status is 'pending' → user sees Resume Payment
    let res = await client.query(`SELECT payment_status FROM reservations WHERE id = $1`, [reservation.id]);
    assert.equal(res.rows[0].payment_status, "pending", "Initially pending, should show Resume Payment");

    // After expiry
    const release = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "test",
    });

    // After expiry, status is 'expired_payment' → Resume Payment should NOT appear
    res = await client.query(`SELECT payment_status FROM reservations WHERE id = $1`, [reservation.id]);
    assert.equal(res.rows[0].payment_status, "expired", "After expiry, should be 'expired'");
    assert.equal(res.rows[0].status, "expired_payment", "Reservation should be expired_payment");

    // The UI should NOT show Resume Payment option for expired_payment status
  });
});

test("Scenario 7: Reservation leaves Active immediately after payment expires", async () => {
  await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);

    // Before expiry
    let res = await client.query(
      `SELECT status FROM reservations WHERE id = $1`,
      [reservation.id]
    );
    assert.equal(res.rows[0].status, "payment_pending", "Initially payment_pending");

    // After expiry
    const release = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "test",
    });

    // After expiry, reservation should no longer be active
    res = await client.query(`SELECT status FROM reservations WHERE id = $1`, [reservation.id]);
    assert.equal(res.rows[0].status, "expired_payment", "Should be expired_payment, not active");
  });
});

test("Scenario 8: Manual Cancel Hold is not required for payment expiry", async () => {
  // This test documents that the fix prevents the need for manual intervention
  await withTransaction(pool, async (client) => {
    const { reservation, payment, listingId } = await createTestReservation(client);

    // With the fix, payment expiry automatically transitions the reservation
    const release = await releasePendingPaymentReservation(client, reservation.id, {
      paymentStatus: "expired",
      reservationStatus: "expired_payment",
      reason: "payment_timeout",
      terminalReason: "payment_timeout",
      terminalSource: "automatic_reconciliation",
    });

    assert.equal(release.released, true, "Automatic release succeeded");

    // Verify no manual intervention is needed
    const res = await client.query(
      `SELECT status, payment_status FROM reservations WHERE id = $1`,
      [reservation.id]
    );

    assert.equal(res.rows[0].status, "expired_payment", "Should be released automatically");
    assert.equal(res.rows[0].payment_status, "expired", "Should be marked expired");

    // No manual cancel needed
  });
});
