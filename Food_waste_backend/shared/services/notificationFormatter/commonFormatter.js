function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
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

function getIconForType(type) {
  if (!type) return "/icon-192x192.png";

  const normalized = String(type).toLowerCase();
  if (normalized.includes("reservation")) return "/icons/reservation.png";
  if (normalized.includes("listing") || normalized.includes("food")) return "/icons/food.png";
  if (normalized.includes("settlement") || normalized.includes("payment")) return "/icons/wallet.png";
  if (normalized.includes("volunteer")) return "/icons/volunteer.png";
  if (normalized.includes("moderation") || normalized.includes("report")) return "/icons/shield.png";

  return "/icon-192x192.png";
}

function formatCommonNotification(notification = {}, metadata = {}) {
  const title = pickFirstNonEmpty(notification?.title, notification?.message, "New notification");
  const body = pickFirstNonEmpty(notification?.message, notification?.title, "You have a new notification");
  const type = String(notification?.type || "").trim();
  const mergedMetadata = {
    ...metadata,
    notificationId: notification?.id,
    type,
  };

  return {
    title,
    body,
    icon: getIconForType(type),
    badge: "/icon-192x192.png",
    image: null,
    tag: `notification:${notification?.id || "unknown"}`,
    data: mergedMetadata,
  };
}

module.exports = {
  formatCommonNotification,
  getIconForType,
};
