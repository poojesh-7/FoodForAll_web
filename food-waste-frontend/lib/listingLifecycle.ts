import type { FoodListingRow } from "@shared/contracts/api-contracts";

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function isActiveListing(listing: FoodListingRow) {
  if (listing.is_deleted || listing.status === "deleted") return false;

  const status = String(listing.status ?? "active").toLowerCase();
  const pickupEnd = listing.pickup_end_time
    ? new Date(listing.pickup_end_time).getTime()
    : Number.NaN;
  const hasFuturePickup = Number.isFinite(pickupEnd) ? pickupEnd > Date.now() : true;
  const remaining = toNumber(listing.remaining_quantity ?? listing.quantity);

  return status === "active" && hasFuturePickup && remaining > 0;
}
