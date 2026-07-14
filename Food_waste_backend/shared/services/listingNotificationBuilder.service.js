function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

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

function getQuantityUnitLabel(metadata = {}) {
  const unit = normalizeText(metadata?.quantity_unit || metadata?.unit || metadata?.quantityUnit);
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

function formatQuantityPhrase(quantity, remainingQuantity, metadata = {}) {
  const normalizedRemaining = Number(remainingQuantity);
  const normalizedQuantity = Number(quantity);
  const actualQuantity = Number.isFinite(normalizedRemaining) && normalizedRemaining >= 0
    ? normalizedRemaining
    : Number.isFinite(normalizedQuantity) && normalizedQuantity > 0
      ? normalizedQuantity
      : null;

  if (actualQuantity === null) {
    return "";
  }

  const unitLabel = getQuantityUnitLabel(metadata);
  const displayUnit = unitLabel ? pluralizeUnit(unitLabel, actualQuantity) : "";
  const quantityText = displayUnit
    ? `${actualQuantity} ${displayUnit}`
    : `${actualQuantity}`;

  const lowQuantity = Number.isFinite(normalizedRemaining) && normalizedRemaining >= 0 && normalizedRemaining <= 2;
  if (lowQuantity) {
    return `Only ${quantityText} remaining`;
  }

  return `${quantityText} available`;
}

function toHumanReadableTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildListingNotificationText(metadata = {}) {
  const titleBase = normalizeText(metadata?.listingTitle || metadata?.foodName || metadata?.name || metadata?.title);
  const title = titleBase ? `${titleBase} Available` : normalizeText(metadata?.title) || "New Food Listing Available";

  const restaurantName = normalizeText(metadata?.restaurant_name || metadata?.restaurantName);
  const quantityText = formatQuantityPhrase(metadata?.quantity, metadata?.remainingQuantity, metadata);
  const pickupTime = toHumanReadableTime(metadata?.pickup_end_time || metadata?.pickupDeadline || metadata?.pickupTime || metadata?.pickup_deadline);

  const bodyLines = [];
  if (restaurantName) bodyLines.push(restaurantName);
  if (quantityText) bodyLines.push(quantityText);
  if (pickupTime) bodyLines.push(`Pickup before ${pickupTime}`);

  const body = bodyLines.join("\n") || normalizeText(metadata?.message) || "A new food listing is available.";

  return { title, message: body };
}

module.exports = {
  buildListingNotificationText,
};
