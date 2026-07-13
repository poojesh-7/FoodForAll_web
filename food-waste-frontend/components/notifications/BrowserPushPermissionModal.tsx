"use client";

import { useEffect, useState } from "react";
import {
  getBrowserPushPermission,
  markBrowserPushReminderDismissed,
  requestBrowserPushSubscription,
  showBrowserPushError,
  showBrowserPushSuccess,
} from "@/lib/browserPush";

type BrowserPushPermissionModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function BrowserPushPermissionModal({
  open,
  onClose,
}: BrowserPushPermissionModalProps) {
  const [permission, setPermission] = useState(getBrowserPushPermission());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPermission(getBrowserPushPermission());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleEnable = async () => {
    setSubmitting(true);

    try {
      const result = await requestBrowserPushSubscription();
      if (result.ok) {
        showBrowserPushSuccess("Notifications enabled on this browser.");
        markBrowserPushReminderDismissed();
        onClose();
        return;
      }

      showBrowserPushError(result.message || "Notifications were not enabled.");
      setPermission(getBrowserPushPermission());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "We could not enable notifications right now.";
      showBrowserPushError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNotNow = () => {
    markBrowserPushReminderDismissed();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Browser notifications
            </p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-950">
              Stay in the loop on this browser
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Enable notifications to get timely alerts from FoodForAll while you browse.
            </p>
          </div>

          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            Current browser permission: <span className="font-medium text-zinc-950">{permission}</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleNotNow}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={handleEnable}
              disabled={submitting}
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Enabling..." : "Enable notifications"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
