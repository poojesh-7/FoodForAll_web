const { getIconForType } = require("./commonFormatter");

const QUANTITY_UNIT_PLURALS = {
  "Meal Box": "Meal Boxes",
  "Food Packet": "Food Packets",
  Plate: "Plates",
  Container: "Containers",
  Tray: "Trays",
  Loaf: "Loaves",
  Bottle: "Bottles",
  Liter: "Liters",
  Kilogram: "Kilograms",
  Piece: "Pieces",
};

function toHumanReadableTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function getQuantityUnitLabel(metadata) {
  const unit = normalizeText(metadata?.quantity_unit || metadata?.unit);
  const customUnit = normalizeText(metadata?.custom_quantity_unit || metadata?.customQuantityUnit);

  if (unit.toLowerCase() === "other") {
    return customUnit;
  }

  return unit || customUnit;
}

function pluralizeUnit(unit, count) {
  if (!unit) return "";
  if (count === 1) return unit;
  if (Object.prototype.hasOwnProperty.call(QUANTITY_UNIT_PLURALS, unit)) {
    return QUANTITY_UNIT_PLURALS[unit];
  }

  if (unit.endsWith("s")) {
    return unit;
  }

  return `${unit}s`;
}

function formatQuantityText(quantity, remainingQuantity, metadata = {}) {
  const normalizedRemaining = Number(remainingQuantity);
  const normalizedQuantity = Number(quantity);
  const quantityCount = Number.isFinite(normalizedRemaining) && normalizedRemaining >= 0
    ? normalizedRemaining
    : Number.isFinite(normalizedQuantity) && normalizedQuantity > 0
      ? normalizedQuantity
      : null;

  if (quantityCount === null) {
    return "Quantity available";
  }

  const unitLabel = getQuantityUnitLabel(metadata);
  const displayUnit = unitLabel ? pluralizeUnit(unitLabel, quantityCount) : "";
  const quantityPhrase = displayUnit
    ? `${quantityCount} ${displayUnit}`
    : `${quantityCount} available`;

  const isLowQuantity = Number.isFinite(normalizedRemaining) && normalizedRemaining >= 0 && normalizedRemaining <= 2;
  if (isLowQuantity) {
    return `Only ${quantityPhrase} remaining`;
  }

  return `${quantityPhrase} available`;
}

function formatListingNotification(notification = {}, metadata = {}) {
  const listingTitle = normalizeText(metadata?.listingTitle || metadata?.foodName || metadata?.name || metadata?.title);
  const restaurantName = normalizeText(metadata?.restaurant_name || metadata?.restaurantName);
  const quantityText = formatQuantityText(metadata?.quantity, metadata?.remainingQuantity, metadata);
  const pickupTime = toHumanReadableTime(metadata?.pickupDeadline || metadata?.pickupTime || metadata?.pickup_deadline || metadata?.pickup_end_time);

  const lines = [];
  if (restaurantName) lines.push(restaurantName);
  if (quantityText) lines.push(quantityText);
  if (pickupTime) lines.push(`Pickup before ${pickupTime}`);

  const title = listingTitle ? `${listingTitle} Available` : pickFirstNonEmpty(notification?.title, "New Food Listing Available", "New notification");
  const body = lines.join("\n");

  const mergedMetadata = {
    ...metadata,
    notificationId: notification?.id,
    type: notification?.type,
  };

  return {
    title,
    body: body || pickFirstNonEmpty(notification?.message, "You have a new notification"),
    icon: getIconForType(notification?.type || "listing"),
    badge: "/icon-192x192.png",
    image: null,
    tag: `notification:${notification?.id || "unknown"}`,
    data: mergedMetadata,
  };
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

module.exports = {
  formatListingNotification,
};
