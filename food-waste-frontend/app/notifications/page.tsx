"use client";

import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import NotificationList from "@/components/notifications/NotificationList";
import { useNotificationStore } from "@/store/notificationStore";

export default function NotificationsPage() {
  const notifications = useNotificationStore((state) => state.notifications);
  const pagination = useNotificationStore((state) => state.pagination);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loading = useNotificationStore((state) => state.loading);
  const loadingMore = useNotificationStore((state) => state.loadingMore);
  const error = useNotificationStore((state) => state.error);
  const loadNotifications = useNotificationStore((state) => state.loadNotifications);
  const loadMoreNotifications = useNotificationStore(
    (state) => state.loadMoreNotifications
  );
  const markAsRead = useNotificationStore((state) => state.markAsRead);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-text-primary">
              Notifications
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Full history of account and pickup updates.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void markAllAsRead()}
            disabled={!unreadCount}
            className="min-h-10 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-border"
          >
            Mark all as read
          </button>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="border-b border-border px-1 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Loaded
            </p>
            <p className="mt-1 text-2xl font-semibold text-zinc-950">
              {notifications.length}
            </p>
          </div>
          <div className="border-b border-border px-1 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Unread
            </p>
            <p className="mt-1 text-2xl font-semibold text-emerald-900">
              {unreadCount}
            </p>
          </div>
          <div className="border-b border-border px-1 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Latest
            </p>
            <p className="mt-1 truncate text-sm font-medium text-zinc-950">
              {notifications[0]?.title || "No notifications"}
            </p>
          </div>
        </section>

        <section>
          <NotificationList
            error={error}
            loading={loading}
            notifications={notifications}
            onMarkAsRead={(id) => void markAsRead(id)}
          />
          {pagination.has_more && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMoreNotifications()}
                disabled={loadingMore}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                {loadingMore ? "Loading" : "Load more"}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
