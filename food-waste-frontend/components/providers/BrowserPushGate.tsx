"use client";

import { useEffect, useRef, useState } from "react";
import BrowserPushPermissionModal from "@/components/notifications/BrowserPushPermissionModal";
import {
  getBrowserPushPermission,
  hasBrowserPushModalBeenShownThisSession,
  isBrowserPushSupported,
  markBrowserPushModalShownThisSession,
  shouldShowBrowserPushReminder,
} from "@/lib/browserPush";
import { useAuthStore } from "@/store/authStore";

export default function BrowserPushGate() {
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isOnboarded = useAuthStore((state) => state.isOnboarded);
  const user = useAuthStore((state) => state.user);
  const [open, setOpen] = useState(false);
  const hasTriggeredRef = useRef(false);

  const support = isBrowserPushSupported();
  const permission = getBrowserPushPermission();
  const reminder = shouldShowBrowserPushReminder();
  const modalShown = hasBrowserPushModalBeenShownThisSession();

  const canPrompt = Boolean(
    initialized &&
      isAuthenticated &&
      isOnboarded &&
      support &&
      permission === "default" &&
      reminder &&
      !modalShown
  );

  console.log("[WEBPUSH_GATE] mounted", {
    initialized,
    isAuthenticated,
    isOnboarded,
    user,
    userRole: user?.role,
    support,
    permission,
    reminder,
    modalShown,
    canPrompt,
    open,
    hasTriggeredRef: hasTriggeredRef.current,
  });

  useEffect(() => {
    console.log("[WEBPUSH_GATE] effect", {
      initialized,
      isAuthenticated,
      isOnboarded,
      support,
      permission,
      reminder,
      modalShown,
      canPrompt,
      open,
      hasTriggeredRef: hasTriggeredRef.current,
    });

    if (!canPrompt || hasTriggeredRef.current) {
      if (!canPrompt && open) {
        setOpen(false);
      }
      return;
    }

    hasTriggeredRef.current = true;
    markBrowserPushModalShownThisSession();

    const timeoutId = window.setTimeout(() => {
      console.log("[WEBPUSH_GATE] opening modal");
      setOpen(true);
    }, 600);

    return () => window.clearTimeout(timeoutId);
  }, [canPrompt, open, initialized, isAuthenticated, isOnboarded, support, permission, reminder, modalShown]);

  return (
    <BrowserPushPermissionModal
      open={open}
      onClose={() => setOpen(false)}
    />
  );
}
