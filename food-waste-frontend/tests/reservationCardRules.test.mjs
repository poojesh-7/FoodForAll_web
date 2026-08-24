import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCancellationRemaining,
  getCancellationGuidance,
  getCancellationRemainingMs,
  isPickupCodeVisible,
} from "../lib/reservationCardRules.ts";

const start = Date.parse("2026-08-24T10:00:00.000Z");
const end = Date.parse("2026-08-24T12:00:00.000Z");

function reservation(overrides = {}) {
  return {
    pickup_code: "4821",
    pickup_type: "self_pickup",
    status: "reserved",
    pickup_start_time: new Date(start).toISOString(),
    pickup_end_time: new Date(end).toISOString(),
    ...overrides,
  };
}

test("pickup code is hidden before the pickup window", () => {
  assert.equal(isPickupCodeVisible(reservation(), start - 1), false);
});

test("pickup code is visible during the active self-pickup window", () => {
  assert.equal(isPickupCodeVisible(reservation(), start), true);
  assert.equal(isPickupCodeVisible(reservation(), end), true);
});

test("pickup code is hidden after pickup or for provider view data", () => {
  assert.equal(isPickupCodeVisible(reservation(), end + 1), false);
  assert.equal(isPickupCodeVisible(reservation({ pickup_type: "ngo" }), start), false);
  assert.equal(isPickupCodeVisible(reservation({ status: "completed" }), start), false);
});

test("cancellation guidance follows the twenty-minute deadline cutoff", () => {
  assert.equal(
    getCancellationGuidance(reservation(), end - 30 * 60 * 1000),
    "Cancel at least 20 minutes before the pickup deadline."
  );
  assert.equal(
    getCancellationGuidance(reservation(), end - 20 * 60 * 1000),
    "Cancellation is unavailable within 20 minutes of pickup deadline."
  );
});

test("cancellation countdown reports the time remaining before the cutoff", () => {
  const remaining = getCancellationRemainingMs(
    reservation(),
    end - 95 * 60 * 1000
  );

  assert.equal(remaining, 75 * 60 * 1000);
  assert.equal(formatCancellationRemaining(remaining), "1h 15m left");
  assert.equal(formatCancellationRemaining(0), "No time left");
});
