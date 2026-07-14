self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePushPayload(event) {
  if (!event.data) {
    return null;
  }

  try {
    return event.data.json();
  } catch (error) {
    try {
      const text = event.data.text();
      return {
        title: "FoodForAll",
        body: text,
      };
    } catch {
      return null;
    }
  }
}

function getNotificationOptions(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      body: "You have a new notification.",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: {},
    };
  }

  return {
    body: payload.body || "You have a new notification.",
    icon: payload.icon || "/favicon.ico",
    badge: payload.badge || "/favicon.ico",
    image: payload.image || undefined,
    tag: payload.tag || undefined,
    data: payload.data || {},
    renotify: payload.renotify === true,
    requireInteraction: payload.requireInteraction === true,
    silent: payload.silent === true,
  };
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = (payload && payload.title) || "FoodForAll";
  const options = getNotificationOptions(payload);

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/notifications"));
});
