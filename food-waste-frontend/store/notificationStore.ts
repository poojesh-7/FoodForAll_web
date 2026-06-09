import { create } from "zustand";
import { notificationService } from "@/services/notification.service";
import type {
  DbId,
  NotificationPagination,
  NotificationRow,
} from "@shared/contracts/api-contracts";

type NotificationSyncMessage =
  | { action: "read"; id: string }
  | { action: "read_all" };

interface NotificationState {
  notifications: NotificationRow[];
  pagination: NotificationPagination;
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  countLoading: boolean;
  error: string;
  loaded: boolean;
  loadNotifications: () => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
  loadUnreadCount: () => Promise<void>;
  receiveNotification: (notification: NotificationRow) => void;
  markAsRead: (id: DbId) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  applyRead: (id: DbId) => void;
  applyReadAll: () => void;
  resetNotifications: () => void;
}

const CHANNEL_NAME = "food-waste-notifications";
const STORAGE_KEY = "food-waste-notification-sync";
const DEFAULT_PAGINATION: NotificationPagination = {
  limit: 30,
  has_more: false,
  next_cursor: null,
};

let channel: BroadcastChannel | null = null;

function getNotificationId(notification: NotificationRow) {
  return notification.id === undefined || notification.id === null
    ? ""
    : String(notification.id);
}

function normalizeNotification(notification: NotificationRow): NotificationRow {
  return {
    ...notification,
    id:
      notification.id ??
      `realtime-${notification.type ?? "notification"}-${Date.now()}`,
    title: notification.title || "Notification",
    message: notification.message || "",
    is_read: Boolean(notification.is_read),
    created_at: notification.created_at || new Date().toISOString(),
  };
}

function sortNewestFirst(notifications: NotificationRow[]) {
  return [...notifications].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });
}

function mergeNotifications(
  current: NotificationRow[],
  incoming: NotificationRow[]
) {
  const byId = new Map<string, NotificationRow>();
  const anonymous: NotificationRow[] = [];

  for (const notification of [...current, ...incoming]) {
    const id = getNotificationId(notification);
    if (!id) {
      anonymous.push(notification);
      continue;
    }
    byId.set(id, notification);
  }

  return sortNewestFirst([...byId.values(), ...anonymous]);
}

function broadcast(message: NotificationSyncMessage) {
  if (typeof window === "undefined") return;

  channel?.postMessage(message);
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...message, syncedAt: Date.now() })
  );
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  pagination: DEFAULT_PAGINATION,
  unreadCount: 0,
  loading: false,
  loadingMore: false,
  countLoading: false,
  error: "",
  loaded: false,

  loadNotifications: async () => {
    try {
      set({ loading: true, error: "" });
      const [page, unreadCount] = await Promise.all([
        notificationService.getNotifications({ limit: DEFAULT_PAGINATION.limit }),
        notificationService.getUnreadCount(),
      ]);
      const normalized = sortNewestFirst(
        page.notifications.map(normalizeNotification)
      );

      set({
        notifications: normalized,
        pagination: page.pagination,
        unreadCount,
        loaded: true,
      });
    } catch (error) {
      set({ error: notificationService.getErrorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  loadMoreNotifications: async () => {
    const nextCursor = get().pagination.next_cursor;
    if (!nextCursor || get().loadingMore) return;

    try {
      set({ loadingMore: true, error: "" });
      const page = await notificationService.getNotifications({
        cursor: nextCursor,
        limit: get().pagination.limit || DEFAULT_PAGINATION.limit,
      });
      const normalized = page.notifications.map(normalizeNotification);

      set((state) => ({
        notifications: mergeNotifications(state.notifications, normalized),
        pagination: page.pagination,
      }));
    } catch (error) {
      set({ error: notificationService.getErrorMessage(error) });
    } finally {
      set({ loadingMore: false });
    }
  },

  loadUnreadCount: async () => {
    try {
      set({ countLoading: true, error: "" });
      const unreadCount = await notificationService.getUnreadCount();
      set((state) => ({
        unreadCount: Math.max(
          unreadCount,
          state.notifications.filter((notification) => !notification.is_read).length
        ),
      }));
    } catch (error) {
      set({ error: notificationService.getErrorMessage(error) });
    } finally {
      set({ countLoading: false });
    }
  },

  receiveNotification: (incoming) => {
    const notification = normalizeNotification(incoming);
    const incomingId = getNotificationId(notification);

    set((state) => {
      const existing = state.notifications.find(
        (item) => getNotificationId(item) === incomingId
      );

      if (existing) {
        return {
          notifications: sortNewestFirst(
            state.notifications.map((item) =>
              getNotificationId(item) === incomingId ? { ...item, ...notification } : item
            )
          ),
        };
      }

      return {
        notifications: sortNewestFirst([notification, ...state.notifications]),
        unreadCount: state.unreadCount + (notification.is_read ? 0 : 1),
      };
    });
  },

  applyRead: (id) => {
    const readId = String(id);

    set((state) => {
      const wasUnread = state.notifications.some(
        (notification) =>
          getNotificationId(notification) === readId && !notification.is_read
      );

      return {
        notifications: state.notifications.map((notification) =>
          getNotificationId(notification) === readId
            ? { ...notification, is_read: true }
            : notification
        ),
        unreadCount: wasUnread
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
      };
    });
  },

  applyReadAll: () => {
    set((state) => ({
      notifications: state.notifications.map((notification) => ({
        ...notification,
        is_read: true,
      })),
      unreadCount: 0,
    }));
  },

  markAsRead: async (id) => {
    const previous = get().notifications;
    const previousCount = get().unreadCount;

    get().applyRead(id);

    try {
      const updated = normalizeNotification(await notificationService.markAsRead(id));
      const updatedId = getNotificationId(updated);

      set((state) => ({
        notifications: state.notifications.map((notification) =>
          getNotificationId(notification) === updatedId ? updated : notification
        ),
      }));
      broadcast({ action: "read", id: String(id) });
    } catch (error) {
      set({
        notifications: previous,
        unreadCount: previousCount,
        error: notificationService.getErrorMessage(error),
      });
    }
  },

  markAllAsRead: async () => {
    const previous = get().notifications;
    const previousCount = get().unreadCount;

    get().applyReadAll();

    try {
      await notificationService.markAllAsRead();
      broadcast({ action: "read_all" });
    } catch (error) {
      set({
        notifications: previous,
        unreadCount: previousCount,
        error: notificationService.getErrorMessage(error),
      });
    }
  },

  resetNotifications: () =>
    set({
      notifications: [],
      pagination: DEFAULT_PAGINATION,
      unreadCount: 0,
      loading: false,
      loadingMore: false,
      countLoading: false,
      error: "",
      loaded: false,
    }),
}));

export function subscribeNotificationSync() {
  if (typeof window === "undefined") return () => {};

  if (!channel && "BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }

  const applyMessage = (message: NotificationSyncMessage) => {
    if (message.action === "read") {
      useNotificationStore.getState().applyRead(message.id);
      return;
    }

    useNotificationStore.getState().applyReadAll();
  };

  const handleChannelMessage = (event: MessageEvent<NotificationSyncMessage>) => {
    applyMessage(event.data);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;

    try {
      applyMessage(JSON.parse(event.newValue) as NotificationSyncMessage);
    } catch {
      // Ignore malformed cross-tab messages.
    }
  };

  channel?.addEventListener("message", handleChannelMessage);
  window.addEventListener("storage", handleStorage);

  return () => {
    channel?.removeEventListener("message", handleChannelMessage);
    window.removeEventListener("storage", handleStorage);
  };
}
