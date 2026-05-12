"use client";

import type { DbId, NotificationRow } from "@backend/contracts/api-contracts";

type NotificationListProps = {
  notifications: NotificationRow[];
  loading?: boolean;
  error?: string;
  compact?: boolean;
  onMarkAsRead?: (id: DbId) => void;
};

function formatRelativeTime(value?: string) {
  if (!value) return "Just now";

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Just now";

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export default function NotificationList({
  notifications,
  loading = false,
  error = "",
  compact = false,
  onMarkAsRead,
}: NotificationListProps) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-20 animate-pulse rounded-md bg-zinc-100"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-700">
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          {error}
        </p>
      </div>
    );
  }

  if (!notifications.length) {
    return (
      <div className="p-6 text-center text-sm text-zinc-500">
        No notifications yet.
      </div>
    );
  }

  return (
    <div className={compact ? "divide-y divide-zinc-100" : "space-y-3"}>
      {notifications.map((notification) => {
        const isUnread = !notification.is_read;
        const id = notification.id;

        return (
          <article
            key={String(id ?? `${notification.type}-${notification.created_at}`)}
            className={`relative ${
              compact
                ? "px-4 py-3"
                : "rounded-lg border px-4 py-3 shadow-sm"
            } ${
              isUnread
                ? "border-emerald-200 bg-emerald-50/80"
                : "border-zinc-200 bg-white"
            }`}
          >
            <div className="flex gap-3">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  isUnread ? "bg-emerald-600" : "bg-zinc-300"
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <h3 className="text-sm font-semibold text-zinc-950">
                    {notification.title || "Notification"}
                  </h3>
                  <time className="shrink-0 text-xs text-zinc-500">
                    {formatRelativeTime(notification.created_at)}
                  </time>
                </div>
                {notification.message && (
                  <p className="mt-1 text-sm leading-5 text-zinc-600">
                    {notification.message}
                  </p>
                )}
                {isUnread && id !== undefined && id !== null && onMarkAsRead && (
                  <button
                    type="button"
                    onClick={() => onMarkAsRead(id)}
                    className="mt-2 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900"
                  >
                    Mark as read
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
