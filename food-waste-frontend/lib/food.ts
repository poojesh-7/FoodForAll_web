import type {
  FoodListingRow,
  ListingImageRow,
  NearbyFoodListing,
} from "@shared/contracts/api-contracts";
import { formatPlatformDateTime } from "./dateTime";
import {
  fallbackQuantityUnit,
  formatQuantityWithUnit,
  normalizeQuantityUnit,
} from "./quantityUnits";
import { sanitizeTextInput } from "./sanitize";

export type FoodCardListing = FoodListingRow | NearbyFoodListing;

const minimumPickupWindowMs = 30 * 60 * 1000;
export const maxListingImages = 5;
export const maxListingImageBytes = 5 * 1024 * 1024;
export const listingImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type FoodFormImage = {
  id: string;
  previewUrl: string;
  file?: File;
  image_url?: string;
  public_id?: string;
  display_order?: number | string;
};

export type FoodFormValues = {
  title: string;
  description: string;
  quantity: string;
  quantity_unit: string;
  custom_quantity_unit: string;
  price: string;
  is_free: boolean;
  pickup_start_time: string;
  pickup_end_time: string;
  images: FoodFormImage[];
};

type FoodValidationOptions = {
  includeQuantity?: boolean;
  includePickupStart?: boolean;
};

export function getFoodValidationError(
  values: FoodFormValues,
  options: boolean | FoodValidationOptions = true
) {
  const includeQuantity =
    typeof options === "boolean" ? options : options.includeQuantity ?? true;
  const includePickupStart =
    typeof options === "boolean" ? options : options.includePickupStart ?? true;
  const title = values.title.trim();
  const quantityUnit = values.quantity_unit.trim();
  const customQuantityUnit = values.custom_quantity_unit.trim();
  const quantity = Number(values.quantity);
  const price = Number(values.price);
  const now = Date.now();
  const startTime = new Date(values.pickup_start_time).getTime();
  const endTime = new Date(values.pickup_end_time).getTime();

  if (!title || !values.pickup_end_time || (includePickupStart && !values.pickup_start_time)) {
    return includePickupStart
      ? "Title, pickup start, and pickup end time are required."
      : "Title and pickup end time are required.";
  }

  if (includeQuantity && (!Number.isFinite(quantity) || quantity <= 0)) {
    return "Quantity must be greater than 0.";
  }

  if (!quantityUnit) {
    return "Quantity unit is required.";
  }

  if (normalizeQuantityUnit(quantityUnit) !== quantityUnit) {
    return "Select a valid quantity unit.";
  }

  if (quantityUnit === "Other" && !customQuantityUnit) {
    return "Custom quantity unit is required when Other is selected.";
  }

  if (quantityUnit !== "Other" && customQuantityUnit) {
    return "Custom quantity unit is only allowed when quantity unit is Other.";
  }

  if ((includePickupStart && !Number.isFinite(startTime)) || !Number.isFinite(endTime)) {
    return "Enter valid pickup times.";
  }

  if (includePickupStart && startTime < now) {
    return "Pickup start time cannot be in the past.";
  }

  if (includePickupStart && startTime >= endTime) {
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

export function getListingImageValidationError(files: File[], currentCount = 0) {
  if (currentCount + files.length > maxListingImages) {
    return `Listings can include up to ${maxListingImages} images.`;
  }

  for (const file of files) {
    if (!listingImageMimeTypes.has(file.type)) {
      return "Only JPG, PNG, or WEBP images are allowed.";
    }

    if (file.size > maxListingImageBytes) {
      return "Each image must be 5 MB or smaller.";
    }
  }

  return null;
}

export function sanitizeFoodFormValues(values: FoodFormValues): FoodFormValues {
  return {
    ...values,
    title: sanitizeTextInput(values.title, { maxLength: 160 }),
    description: sanitizeTextInput(values.description, {
      maxLength: 2000,
      preserveNewlines: true,
    }),
    quantity_unit: normalizeQuantityUnit(values.quantity_unit || fallbackQuantityUnit),
    custom_quantity_unit:
      values.quantity_unit === "Other"
        ? sanitizeTextInput(values.custom_quantity_unit, { maxLength: 80 })
        : "",
  };
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
  return Number.isNaN(date.getTime()) ? "-" : formatPlatformDateTime(date);
}

function toFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getField(source: object, key: string) {
  return (source as Record<string, unknown>)[key];
}

export function getDistanceKm(source: object) {
  const explicitDistanceKm =
    toFiniteNumber(getField(source, "distanceKm")) ??
    toFiniteNumber(getField(source, "distance_km"));

  if (explicitDistanceKm !== null) return explicitDistanceKm;

  const legacyDistance = toFiniteNumber(getField(source, "distance"));
  if (legacyDistance === null) return null;

  return legacyDistance > 100 ? legacyDistance / 1000 : legacyDistance;
}

export function formatDistanceKm(source: object) {
  const distanceKm = getDistanceKm(source);
  return distanceKm === null ? null : `${distanceKm.toFixed(1)} km`;
}

export function getRescueRadiusKm(source: object) {
  return (
    toFiniteNumber(getField(source, "ngoServiceRadiusKm")) ??
    toFiniteNumber(getField(source, "ngo_service_radius_km")) ??
    toFiniteNumber(getField(source, "service_radius_km"))
  );
}

export function isOutsideRescueRadius(source: object) {
  const distanceKm = getDistanceKm(source);
  const rescueRadiusKm = getRescueRadiusKm(source);

  return (
    distanceKm !== null &&
    rescueRadiusKm !== null &&
    distanceKm > rescueRadiusKm
  );
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

export { formatQuantityWithUnit };

export function getPrimaryImageUrl(source?: {
  primary_image_url?: string | null;
  images?: ListingImageRow[] | null;
}) {
  if (!source) return null;
  if (source.primary_image_url) return source.primary_image_url;
  const images = Array.isArray(source.images) ? source.images : [];
  const firstImage = [...images].sort(
    (left, right) => Number(left.display_order) - Number(right.display_order)
  )[0];
  return firstImage?.image_url || null;
}

export function sortListingImages(images?: ListingImageRow[] | null) {
  return [...(images ?? [])].sort(
    (left, right) => Number(left.display_order) - Number(right.display_order)
  );
}

function isUsableRestaurantName(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text.toLowerCase() === "unknown provider") {
    return false;
  }

  return !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text
  );
}

export function getRestaurantDisplayName(
  source: { restaurant_name?: unknown; provider_name?: unknown },
  fallback = "Restaurant unavailable"
) {
  if (isUsableRestaurantName(source.restaurant_name)) {
    return String(source.restaurant_name).trim();
  }

  if (isUsableRestaurantName(source.provider_name)) {
    return String(source.provider_name).trim();
  }

  return fallback;
}

export function isFreeRescueListing(listing: FoodCardListing) {
  return (
    Boolean("is_free" in listing && listing.is_free) ||
    Number("price" in listing ? listing.price : 0) === 0
  );
}
