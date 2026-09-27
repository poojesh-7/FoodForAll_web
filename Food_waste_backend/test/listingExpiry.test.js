const assert = require("node:assert/strict");
const test = require("node:test");

const {
  expiryJobIds,
  matchesExpiryDeadline,
} = require("../shared/utils/listingExpiry");

test("listing expiry job IDs are unique per deadline", () => {
  const firstDeadline = Date.parse("2026-09-26T18:00:00.000Z");
  const secondDeadline = Date.parse("2026-09-26T19:00:00.000Z");
  const first = expiryJobIds("listing-1", firstDeadline);
  const second = expiryJobIds("listing-1", secondDeadline);

  assert.notEqual(first.expiryJobId, second.expiryJobId);
  assert.notEqual(first.alertJobId, second.alertJobId);
  assert.equal(first.legacyExpiryJobId, "expiry-listing-1");
  assert.equal(first.legacyAlertJobId, "alert-listing-1");
  assert.doesNotMatch(first.expiryJobId, /:/);
  assert.doesNotMatch(first.alertJobId, /:/);
});

test("expiry workers can distinguish stale jobs while accepting legacy jobs", () => {
  const currentDeadline = Date.parse("2026-09-26T19:00:00.000Z");

  assert.equal(matchesExpiryDeadline(currentDeadline, new Date(currentDeadline)), true);
  assert.equal(matchesExpiryDeadline(currentDeadline - 1, new Date(currentDeadline)), false);
  assert.equal(matchesExpiryDeadline(undefined, new Date(currentDeadline)), true);
});