const assert = require("node:assert/strict");
const test = require("node:test");

const { formatBrowserPushNotification } = require("../shared/services/notificationFormatter");

test("common formatter preserves existing notification text and metadata", () => {
  const formatted = formatBrowserPushNotification(
    {
      id: "notif-1",
      type: "reservation_created",
      title: "Reservation confirmed",
      message: "Your reservation is ready",
    },
    { reservationId: "res-1", href: "/reservations/res-1" }
  );

  assert.equal(formatted.title, "Reservation confirmed");
  assert.equal(formatted.body, "Your reservation is ready");
  assert.equal(formatted.data.notificationId, "notif-1");
  assert.equal(formatted.data.reservationId, "res-1");
  assert.equal(formatted.data.href, "/reservations/res-1");
});

test("listing formatter builds richer content from listing metadata", () => {
  const formatted = formatBrowserPushNotification(
    {
      id: "notif-2",
      type: "listing_created",
      title: "New food listing",
      message: "A new listing was posted",
    },
    {
      listingTitle: "Fresh Veg Biryani",
      providerName: "Paradise Restaurant",
      quantity: 12,
      remainingQuantity: 12,
      pickupDeadline: "2026-07-14T20:30:00.000Z",
    }
  );

  assert.match(formatted.title, /New food listing/);
  assert.match(formatted.body, /Fresh Veg Biryani/);
  assert.match(formatted.body, /Paradise Restaurant/);
  assert.match(formatted.body, /12 portions available/);
  assert.match(formatted.body, /Pickup before/);
  assert.equal(formatted.icon, "/icons/food.png");
});
