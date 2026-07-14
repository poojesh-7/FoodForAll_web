const { getIconForType } = require("./commonFormatter");

function toHumanReadableTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function toQuantityText(quantity, remainingQuantity) {
  const normalizedQuantity = Number(quantity);
  const normalizedRemaining = Number(remainingQuantity);

  if (Number.isFinite(normalizedRemaining) && normalizedRemaining >= 0) {
    return `${normalizedRemaining} portions available`;
  }

  if (Number.isFinite(normalizedQuantity) && normalizedQuantity > 0) {
    return `${normalizedQuantity} portions available`;
  }

  return "Quantity available";
}

function formatListingNotification(notification = {}, metadata = {}) {
  const listingTitle = metadata?.listingTitle || metadata?.foodName || metadata?.name || metadata?.title || "";
  const providerName = metadata?.providerName || metadata?.restaurantName || metadata?.restaurant || metadata?.provider || "";
  const quantityText = toQuantityText(metadata?.quantity, metadata?.remainingQuantity);
  const pickupTime = toHumanReadableTime(metadata?.pickupDeadline || metadata?.pickupTime || metadata?.pickup_deadline);

  const lines = [];
  if (listingTitle) lines.push(listingTitle);
  if (providerName) lines.push(providerName);
  if (quantityText) lines.push(quantityText);
  if (pickupTime) lines.push(`Pickup before ${pickupTime}`);

  const title = pickFirstNonEmpty(notification?.title, "New Food Listing Available", "New notification");
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
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

module.exports = {
  formatListingNotification,
};
