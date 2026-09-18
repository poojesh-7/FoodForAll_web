const assert = require("node:assert/strict");
const test = require("node:test");

const { populateReservationPickupCodes } = require("../shared/services/reservationPickupCodes");

test("initial reservation creation generates pickup codes immediately", () => {
  const result = populateReservationPickupCodes({});

  assert.ok(typeof result.pickup_code === "string");
  assert.ok(result.pickup_code.length > 0);
  assert.ok(typeof result.receive_code === "string");
  assert.ok(result.receive_code.length > 0);
});

test("existing reservation codes are preserved", () => {
  const result = populateReservationPickupCodes({
    pickup_code: "ABCD",
    receive_code: "WXYZ",
  });

  assert.equal(result.pickup_code, "ABCD");
  assert.equal(result.receive_code, "WXYZ");
});
