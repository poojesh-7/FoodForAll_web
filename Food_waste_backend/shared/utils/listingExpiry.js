function expiryJobIds(listingId, endTime) {
  const deadline = new Date(endTime).getTime();

  if (!Number.isFinite(deadline)) {
    throw new Error("A valid listing expiry deadline is required");
  }

  return {
    expiryJobId: `expiry-${listingId}-${deadline}`,
    alertJobId: `alert-${listingId}-${deadline}`,
    legacyExpiryJobId: `expiry-${listingId}`,
    legacyAlertJobId: `alert-${listingId}`,
    expectedEndTimeMs: deadline,
  };
}

function matchesExpiryDeadline(expectedEndTimeMs, currentEndTime) {
  if (expectedEndTimeMs === undefined || expectedEndTimeMs === null) return true;

  const expected = Number(expectedEndTimeMs);
  const current = new Date(currentEndTime).getTime();
  return Number.isFinite(expected) && expected === current;
}

module.exports = {
  expiryJobIds,
  matchesExpiryDeadline,
};