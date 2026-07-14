const { formatCommonNotification } = require("./commonFormatter");
const { formatListingNotification } = require("./listingFormatter");

function formatBrowserPushNotification(notification = {}, metadata = {}) {
  const normalizedNotification = {
    ...notification,
    type: String(notification?.type || "").trim().toLowerCase(),
  };

  if (normalizedNotification.type.startsWith("listing") || normalizedNotification.type === "food_listing") {
    return formatListingNotification(normalizedNotification, metadata);
  }

  return formatCommonNotification(normalizedNotification, metadata);
}

module.exports = {
  formatBrowserPushNotification,
};
