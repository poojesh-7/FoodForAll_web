"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import NotificationList from "@/components/notifications/NotificationList";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";

function BellIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M10 21h4" />
    </svg>
  );
}

export default function NotificationBell() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loading = useNotificationStore((state) => state.loading);
  const error = useNotificationStore((state) => state.error);
  const loaded = useNotificationStore((state) => state.loaded);
  const loadNotifications = useNotificationStore((state) => state.loadNotifications);
  const loadUnreadCount = useNotificationStore((state) => state.loadUnreadCount);
  const markAsRead = useNotificationStore((state) => state.markAsRead);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);

  useEffect(() => {
    if (isAuthenticated) {
      void loadUnreadCount();
    }
  }, [isAuthenticated, loadUnreadCount]);

  useEffect(() => {
    if (open && !loaded) {
      void loadNotifications();
    }
  }, [loaded, loadNotifications, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!isAuthenticated) return null;

  const displayCount = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-white">
            {displayCount}
          </span>
        )}
      </button>

      <div
        className={`fixed inset-x-2 top-16 z-50 max-h-[calc(100dvh-5rem)] origin-top-right overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl transition duration-150 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(24rem,calc(100vw-1rem))] ${
          open
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">
              Notifications
            </h2>
            <p className="text-xs text-zinc-500">
              {unreadCount ? `${unreadCount} unread` : "All caught up"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void markAllAsRead()}
            disabled={!unreadCount}
            className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-900 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            Mark all
          </button>
        </div>

        <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto sm:max-h-[26rem]">
          <NotificationList
            compact
            error={error}
            loading={loading}
            notifications={notifications.slice(0, 12)}
            onMarkAsRead={(id) => void markAsRead(id)}
          />
        </div>

        <div className="border-t border-zinc-100 p-2">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-center text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
          >
            View all notifications
          </Link>
        </div>
      </div>
    </div>
  );
}
