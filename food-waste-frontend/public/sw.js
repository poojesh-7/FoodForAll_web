self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = event.data?.text() || "You have a new notification.";
  const title = "FoodForAll";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/notifications"));
});
