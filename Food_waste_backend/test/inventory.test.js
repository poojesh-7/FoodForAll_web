const assert = require("node:assert/strict");
const test = require("node:test");

const {
  reserveListingStock,
  restoreListingStock,
} = require("../shared/services/inventory.service");
const {
  releasePendingPaymentReservation,
  restoreReservationStockIfHeld,
} = require("../shared/services/reservationConsistency.service");
const {
  pendingPaymentReservationWhere,
} = require("../shared/services/reservationLock.service");

function clientWithRows(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

function createPendingReleaseClient({
  stockReserved = true,
  reservationStatus = "payment_pending",
  reservationPaymentStatus = "pending",
  paymentStatus = "pending",
} = {}) {
  const calls = [];
  const state = {
    listing: {
      id: "listing-1",
      provider_id: "provider-1",
      pickup_end_time: new Date(Date.now() + 60_000).toISOString(),
      remaining_quantity: 3,
      status: "completed",
      is_free: false,
    },
    reservation: {
      id: "reservation-1",
      listing_id: "listing-1",
      user_id: "user-1",
      quantity_reserved: 2,
      pickup_type: "self_pickup",
      task_status: "self_pickup",
      status: reservationStatus,
      payment_status: reservationPaymentStatus,
      payment_context: { stock_reserved: stockReserved },
      payment_expires_at: new Date(Date.now() - 60_000).toISOString(),
      reserved_at: new Date(Date.now() - 120_000).toISOString(),
      provider_id: "provider-1",
      is_free: false,
      price: 10,
    },
    payment: paymentStatus
      ? {
          id: "payment-1",
          reservation_id: "reservation-1",
          order_id: "order-1",
          payment_session_id: "session-1",
          status: paymentStatus,
          food_amount: 20,
          reliability_deposit_amount: 0,
        }
      : null,
    paymentOwnership: {
      id: "ownership-1",
      reservation_id: "reservation-1",
      payment_session_id: "session-1",
      payer_user_id: "user-1",
      payer_role: "user",
      provider_id: "provider-1",
      beneficiary_user_id: "provider-1",
      beneficiary_role: "provider",
      refund_target_user_id: "user-1",
      refund_target_role: "user",
      food_amount: 20,
      deposit_amount: 0,
      commission_amount: 0,
      currency: "INR",
      ownership_version: 1,
      snapshot_hash: "snapshot-hash-1",
    },
    financialOperations: [],
  };

  return {
    calls,
    state,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (/SELECT id, listing_id\s+FROM reservations/i.test(sql)) {
        return {
          rows: state.reservation
            ? [{ id: state.reservation.id, listing_id: state.reservation.listing_id }]
            : [],
          rowCount: state.reservation ? 1 : 0,
        };
      }

      if (/SELECT \*\s+FROM food_listings/i.test(sql)) {
        return { rows: [state.listing], rowCount: 1 };
      }

      if (/SELECT r\.\*, f\.provider_id/i.test(sql)) {
        return {
          rows: [
            {
              ...state.reservation,
              provider_id: state.listing.provider_id,
              pickup_end_time: state.listing.pickup_end_time,
              is_free: state.listing.is_free,
            },
          ],
          rowCount: 1,
        };
      }

      if (/SELECT id\s+FROM payments\s+WHERE reservation_id=\$1\s+ORDER BY/i.test(sql)) {
        return {
          rows: state.payment ? [{ id: state.payment.id }] : [],
          rowCount: state.payment ? 1 : 0,
        };
      }

      if (/SELECT \*\s+FROM payments\s+WHERE id=\$1/i.test(sql)) {
        return {
          rows: state.payment ? [state.payment] : [],
          rowCount: state.payment ? 1 : 0,
        };
      }

      if (/UPDATE reservations\s+SET payment_context/i.test(sql)) {
        if (state.reservation.payment_context.stock_reserved === false) {
          return { rows: [], rowCount: 0 };
        }
        state.reservation.payment_context = {
          ...state.reservation.payment_context,
          stock_reserved: false,
          stock_restore_reason: params[1],
        };
        return { rows: [{ id: state.reservation.id }], rowCount: 1 };
      }

      if (/UPDATE food_listings\s+SET remaining_quantity = remaining_quantity \+ \$1/i.test(sql)) {
        state.listing.remaining_quantity += params[0];
        state.listing.status = "active";
        return { rows: [state.listing], rowCount: 1 };
      }

      if (/UPDATE payments\s+SET status=\$2/i.test(sql)) {
        if (state.payment?.status === "pending") {
          state.payment.status = params[1];
          state.payment.gateway_status = params[2];
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (/UPDATE reservations\s+SET status=\$2/i.test(sql)) {
        if (
          state.reservation.status === "payment_pending" &&
          state.reservation.payment_status === "pending"
        ) {
          state.reservation.status = params[1];
          state.reservation.payment_status = params[2];
          state.reservation.payment_context = {
            ...state.reservation.payment_context,
            payment_terminal_source: params[3],
            payment_release_reason: params[4],
          };
          return { rows: [state.reservation], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (/SELECT \*\s+FROM payment_ownership/i.test(sql)) {
        return { rows: [state.paymentOwnership], rowCount: 1 };
      }

      if (/INSERT INTO financial_operations/i.test(sql)) {
        const operation = {
          id: `operation-${state.financialOperations.length + 1}`,
          operation_type: params[0],
          operation_source: params[1],
          reservation_id: params[2],
          payment_session_id: params[3],
          payment_ownership_id: params[4],
          actor_user_id: params[5],
          actor_role: params[6],
          amount: params[7],
          currency: params[8],
          idempotency_key: params[9],
          status: params[10],
          metadata: JSON.parse(params[11] || "{}"),
        };
        state.financialOperations.push(operation);
        return { rows: [operation], rowCount: 1 };
      }

      if (/SELECT r\.id, r\.user_id/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

function restoredStockUpdateCount(client) {
  return client.calls.filter((call) =>
    /UPDATE food_listings\s+SET remaining_quantity = remaining_quantity \+ \$1/i.test(
      call.sql
    )
  ).length;
}

test("reserveListingStock performs an atomic conditional decrement", async () => {
  const client = clientWithRows([{ id: "listing-1", remaining_quantity: 1 }]);

  await reserveListingStock(client, {
    listingId: "listing-1",
    quantity: 2,
  });

  assert.match(client.calls[0].sql, /UPDATE food_listings/);
  assert.match(client.calls[0].sql, /remaining_quantity = remaining_quantity - \$1/);
  assert.match(client.calls[0].sql, /AND remaining_quantity >= \$1/);
  assert.deepEqual(client.calls[0].params, [2, "listing-1", true]);
});

test("reserveListingStock rejects insufficient inventory without decrementing", async () => {
  const client = clientWithRows([]);

  await assert.rejects(
    () => reserveListingStock(client, { listingId: "listing-1", quantity: 3 }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.reason, "insufficient_inventory");
      return true;
    }
  );
});

test("restoreListingStock uses one bounded stock restoration update", async () => {
  const client = clientWithRows([{ id: "listing-1", remaining_quantity: 4 }]);

  await restoreListingStock(client, {
    listingId: "listing-1",
    quantity: 2,
  });

  assert.match(client.calls[0].sql, /UPDATE food_listings/);
  assert.match(client.calls[0].sql, /remaining_quantity = remaining_quantity \+ \$1/);
  assert.match(client.calls[0].sql, /pickup_end_time > NOW\(\)/);
  assert.deepEqual(client.calls[0].params, [2, "listing-1", true]);
});

test("restoreReservationStockIfHeld casts JSONB reason parameter", async () => {
  const client = clientWithRows([]);

  await restoreReservationStockIfHeld(
    client,
    {
      id: "reservation-1",
      listing_id: "listing-1",
      quantity_reserved: 1,
      payment_context: {},
    },
    { reason: "payment_cancelled_before_confirmation" }
  );

  assert.match(client.calls[0].sql, /stock_restore_reason', \$2::text/);
  assert.deepEqual(client.calls[0].params, [
    "reservation-1",
    "payment_cancelled_before_confirmation",
  ]);
});

test("pendingPaymentReservationWhere blocks duplicate in-flight checkout holds", () => {
  assert.equal(
    pendingPaymentReservationWhere("r"),
    "r.status='payment_pending' AND r.payment_status='pending'"
  );
});

test("payment timeout release restores stock and expires the reservation", async () => {
  const client = createPendingReleaseClient();

  const result = await releasePendingPaymentReservation(client, "reservation-1", {
    paymentStatus: "expired",
    reason: "payment_expired",
    terminalSource: "gateway_reconciliation",
  });

  assert.equal(result.released, true);
  assert.equal(client.state.listing.remaining_quantity, 5);
  assert.equal(client.state.reservation.status, "expired_payment");
  assert.equal(client.state.reservation.payment_status, "expired");
  assert.equal(client.state.payment.status, "expired");
});

test("manual cancel hold release restores stock and cancels before confirmation", async () => {
  const client = createPendingReleaseClient();

  const result = await releasePendingPaymentReservation(client, "reservation-1", {
    paymentStatus: "failed",
    reservationStatus: "cancelled_before_confirmation",
    reason: "payment_cancelled_before_confirmation",
    terminalSource: "manual_cancel_hold",
  });

  assert.equal(result.released, true);
  assert.equal(client.state.listing.remaining_quantity, 5);
  assert.equal(client.state.reservation.status, "cancelled_before_confirmation");
  assert.equal(client.state.reservation.payment_status, "failed");
  assert.equal(client.state.payment.status, "failed");
});

test("repeated timeout release is idempotent after stock was already restored", async () => {
  const client = createPendingReleaseClient({ stockReserved: false });

  const result = await releasePendingPaymentReservation(client, "reservation-1", {
    paymentStatus: "expired",
    reason: "payment_expired",
  });

  assert.equal(result.released, true);
  assert.equal(result.stockRestored, false);
  assert.equal(client.state.listing.remaining_quantity, 3);
  assert.equal(client.state.reservation.status, "expired_payment");
  assert.equal(restoredStockUpdateCount(client), 0);
});

test("timeout after successful payment performs no release", async () => {
  const client = createPendingReleaseClient({ paymentStatus: "paid" });

  const result = await releasePendingPaymentReservation(client, "reservation-1", {
    paymentStatus: "expired",
    reason: "payment_expired",
  });

  assert.equal(result.released, false);
  assert.equal(result.reason, "payment_already_terminal");
  assert.equal(client.state.listing.remaining_quantity, 3);
  assert.equal(client.state.reservation.status, "payment_pending");
  assert.equal(restoredStockUpdateCount(client), 0);
});

test("duplicate timeout worker execution does not double restore inventory", async () => {
  const client = createPendingReleaseClient();

  await releasePendingPaymentReservation(client, "reservation-1", {
    paymentStatus: "expired",
    reason: "payment_expired",
  });
  const second = await releasePendingPaymentReservation(client, "reservation-1", {
    paymentStatus: "expired",
    reason: "payment_expired",
  });

  assert.equal(second.released, false);
  assert.equal(second.reason, "reservation_not_pending_payment");
  assert.equal(client.state.listing.remaining_quantity, 5);
  assert.equal(restoredStockUpdateCount(client), 1);
});
