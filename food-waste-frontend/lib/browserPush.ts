"use client";

import api from "@/lib/axios";
import toast from "react-hot-toast";

const BROWSER_PUSH_REMINDER_STORAGE_KEY = "food-waste-browser-push-reminder";
const BROWSER_PUSH_REMINDER_DELAY_MS = 1000 * 60 * 60 * 24 * 3;
let browserPushModalShownThisSession = false;

function getVapidPublicKey() {
  const vapidKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY ||
    "";

  if (!vapidKey) {
    throw new Error("Missing VAPID public key for browser push registration.");
  }

  return vapidKey;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(normalized);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

export function isBrowserPushSupported() {
  if (typeof window === "undefined") return false;
  return Boolean("Notification" in window && "serviceWorker" in navigator);
}

export function getBrowserPushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  if (!isBrowserPushSupported()) return "unsupported";
  return window.Notification.permission;
}

export function shouldShowBrowserPushReminder() {
  if (typeof window === "undefined") {
    console.log("[WEBPUSH_GATE] reminder window undefined");
    return false;
  }

  const storedValue = window.localStorage.getItem(BROWSER_PUSH_REMINDER_STORAGE_KEY);
  console.log("[WEBPUSH_GATE] reminder storage", { storedValue, key: BROWSER_PUSH_REMINDER_STORAGE_KEY });
  if (!storedValue) {
    console.log("[WEBPUSH_GATE] reminder => no stored value, show reminder");
    return true;
  }

  const lastDismissedAt = Number(storedValue);
  if (!Number.isFinite(lastDismissedAt)) {
    console.log("[WEBPUSH_GATE] reminder => invalid stored value, show reminder");
    return true;
  }

  const elapsed = Date.now() - lastDismissedAt;
  const show = elapsed >= BROWSER_PUSH_REMINDER_DELAY_MS;
  console.log("[WEBPUSH_GATE] reminder evaluation", {
    elapsed,
    thresholdMs: BROWSER_PUSH_REMINDER_DELAY_MS,
    show,
  });
  return show;
}

export function markBrowserPushReminderDismissed() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    BROWSER_PUSH_REMINDER_STORAGE_KEY,
    String(Date.now())
  );
}

export function clearBrowserPushReminder() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BROWSER_PUSH_REMINDER_STORAGE_KEY);
}

export function markBrowserPushModalShownThisSession() {
  browserPushModalShownThisSession = true;
}

export function hasBrowserPushModalBeenShownThisSession() {
  return browserPushModalShownThisSession;
}

export async function registerBrowserPushServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    await navigator.serviceWorker.ready;
    return registration;
  } catch {
    return null;
  }
}

export async function requestBrowserPushSubscription() {
  if (!isBrowserPushSupported()) {
    throw new Error("Browser notifications are not supported in this browser.");
  }

  const permission = getBrowserPushPermission();
  if (permission === "denied") {
    return {
      ok: false,
      permission,
      message: "Notifications are blocked in this browser.",
    };
  }

  if (permission === "default") {
    const nextPermission = await window.Notification.requestPermission();
    if (nextPermission !== "granted") {
      return {
        ok: false,
        permission: nextPermission,
        message: "Notifications permission was not granted.",
      };
    }
  }

  await registerBrowserPushServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = urlBase64ToUint8Array(getVapidPublicKey());
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const response = await api.post("/notifications/browser-push", {
    subscription: subscription.toJSON(),
    userAgent: navigator.userAgent,
  });

  return {
    ok: true,
    permission: getBrowserPushPermission(),
    message: response?.data?.message || "Notifications are enabled on this browser.",
  };
}

export function showBrowserPushSuccess(message: string) {
  toast.success(message);
}

export function showBrowserPushError(message: string) {
  toast.error(message);
}
