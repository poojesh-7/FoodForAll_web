"use client";

import { useEffect, useRef, useState } from "react";
import BrowserPushPermissionModal from "@/components/notifications/BrowserPushPermissionModal";
import {
  getBrowserPushPermission,
  isBrowserPushSupported,
  markBrowserPushModalShownThisSession,
  shouldShowBrowserPushReminder,
} from "@/lib/browserPush";
import { useAuthStore } from "@/store/authStore";

export default function BrowserPushGate() {
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isOnboarded = useAuthStore((state) => state.isOnboarded);
  const [open, setOpen] = useState(false);
  const [readyToPrompt, setReadyToPrompt] = useState(false);
  const hasTriggeredRef = useRef(false);

  const support = isBrowserPushSupported();
  const permission = getBrowserPushPermission();
  const reminder = shouldShowBrowserPushReminder();

  useEffect(() => {
    if (!initialized || !isAuthenticated || !isOnboarded) {
      setReadyToPrompt(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setReadyToPrompt(true);
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [initialized, isAuthenticated, isOnboarded]);

  const canPrompt = Boolean(
    readyToPrompt &&
      initialized &&
      isAuthenticated &&
      isOnboarded &&
      support &&
      permission === "default" &&
      reminder
  );

  useEffect(() => {
    if (!canPrompt || hasTriggeredRef.current) {
      return;
    }

    hasTriggeredRef.current = true;
    markBrowserPushModalShownThisSession();

    const timeoutId = window.setTimeout(() => {
      setOpen(true);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [canPrompt, initialized, isAuthenticated, isOnboarded, support, permission, reminder]);

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <BrowserPushPermissionModal
      open={open}
      onClose={handleClose}
    />
  );
}
