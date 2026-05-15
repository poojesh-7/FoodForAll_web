import type { FoodListingRow, NearbyFoodListing } from "@backend/contracts/api-contracts";

export type FoodCardListing = FoodListingRow | NearbyFoodListing;

const minimumPickupWindowMs = 30 * 60 * 1000;

export type FoodFormValues = {
  title: string;
  description: string;
  quantity: string;
  price: string;
  is_free: boolean;
  pickup_start_time: string;
  pickup_end_time: string;
};

export function getFoodValidationError(values: FoodFormValues, includeQuantity = true) {
  const title = values.title.trim();
  const quantity = Number(values.quantity);
  const price = Number(values.price);
  const now = Date.now();
  const startTime = new Date(values.pickup_start_time).getTime();
  const endTime = new Date(values.pickup_end_time).getTime();

  if (!title || !values.pickup_start_time || !values.pickup_end_time) {
    return "Title, pickup start, and pickup end time are required.";
  }

  if (includeQuantity && (!Number.isFinite(quantity) || quantity <= 0)) {
    return "Quantity must be greater than 0.";
  }

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return "Enter valid pickup times.";
  }

  if (startTime < now) {
    return "Pickup start time cannot be in the past.";
  }

  if (startTime >= endTime) {
    return "Start time must be before end time.";
  }

  if (endTime <= now) {
    return "Pickup end time must be in the future.";
  }

  if (endTime - now < minimumPickupWindowMs) {
    return "Minimum pickup window is 30 minutes.";
  }

  if (values.is_free && price > 0) {
    return "Free food cannot have a price.";
  }

  if (!values.is_free && (!Number.isFinite(price) || price <= 0)) {
    return "Paid food must have a valid price.";
  }

  return null;
}

export function toDateTimeLocal(value?: string | number | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function formatFoodDate(value?: string | number | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

export function isNormalUserPaidListing(listing: FoodCardListing) {
  return listing.status === "active" && listing.is_free === false;
}

export function getListingId(listing: FoodCardListing) {
  return listing.id;
}

export function getListingPrice(listing: FoodCardListing) {
  if (!("is_free" in listing)) return "";
  if (listing.is_free) return "Free";
  return `Rs. ${String("price" in listing ? listing.price ?? 0 : 0)}`;
}
