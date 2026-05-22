const assert = require("node:assert/strict");
const test = require("node:test");

const {
  reserveListingStock,
  restoreListingStock,
} = require("../shared/services/inventory.service");
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

test("pendingPaymentReservationWhere blocks duplicate in-flight checkout holds", () => {
  assert.equal(
    pendingPaymentReservationWhere("r"),
    "r.status='payment_pending' AND r.payment_status='pending'"
  );
});
