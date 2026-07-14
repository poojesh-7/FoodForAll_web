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

function getNotificationUrl(notification) {
  const data = notification?.data || {};
  const href = typeof data.href === "string" && data.href.trim() ? data.href.trim() : null;
  if (href) {
    return href;
  }

  const type = String(data.type || "").trim().toLowerCase();
  if (type.startsWith("listing_")) {
    return "/food";
  }
  if (
    type === "listing_reserved" ||
    type === "listing_updated" ||
    type === "listing_expiring"
  ) {
    return "/food";
  }
  if (type.startsWith("reservation_")) {
    return "/reservations";
  }
  if (type.startsWith("provider_settlement") || type.includes("settlement")) {
    return "/provider/settlements";
  }
  if (type.startsWith("volunteer_request") || type.includes("volunteer")) {
    return "/volunteer/requests";
  }
  if (type.includes("appeal")) {
    return "/trust/appeals";
  }
  if (type.includes("trust")) {
    return "/trust";
  }

  return "/notifications";
}

function normalizeNavigationUrl(url) {
  if (typeof url !== "string") {
    return null;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, self.registration.scope);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    if (new URL(self.registration.scope).origin !== parsed.origin) {
      return null;
    }

    return parsed.pathname + parsed.search + parsed.hash;
  } catch (error) {
    return null;
  }
}

async function navigateOrOpenUrl(url) {
  const safeUrl = normalizeNavigationUrl(url);
  if (!safeUrl) {
    return;
  }

  const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (allClients.length > 0) {
    const target = new URL(safeUrl, self.registration.scope).href;

    for (const client of allClients) {
      try {
        if (new URL(client.url).href === target) {
          await client.focus();
          return;
        }
      } catch (error) {
        // ignore invalid URLs or cross-origin clients
      }
    }

    const client = allClients[0];
    try {
      await client.navigate(safeUrl);
      await client.focus();
      return;
    } catch (error) {
      // fallback to opening a new window
    }
  }

  await self.clients.openWindow(safeUrl);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(navigateOrOpenUrl(getNotificationUrl(event.notification)));
});
