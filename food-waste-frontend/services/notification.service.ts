import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  DbId,
  GetNotificationsResponse,
  MarkNotificationReadResponse,
  NotificationPageData,
  NotificationPagination,
  NotificationRow,
  UnreadCountResponse,
} from "@shared/contracts/api-contracts";

function encodeId(id: DbId) {
  return encodeURIComponent(String(id));
}

function getEnvelopeData<TData>(body: { data: TData } | TData): TData {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: TData }).data;
  }

  return body as TData;
}

function getArrayData<TItem>(body: { data: TItem[] } | TItem[] | unknown): TItem[] {
  const data = getEnvelopeData<TItem[] | unknown>(body);
  return Array.isArray(data)
    ? data.filter((item): item is TItem => Boolean(item) && typeof item === "object")
    : [];
}

function getHeaderValue(
  headers: Record<string, unknown>,
  name: string
): string | null {
  const getter = (headers as { get?: (headerName: string) => unknown }).get;
  const fromGetter = typeof getter === "function" ? getter.call(headers, name) : null;
  const exact = headers[name];
  const lower = headers[name.toLowerCase()];
  const value = fromGetter ?? exact ?? lower;
  return typeof value === "string" && value.trim() ? value : null;
}

function parseHeaderPagination(
  headers: Record<string, unknown>,
  fallbackLimit: number
): NotificationPagination {
  const nextCursor = getHeaderValue(headers, "x-next-cursor");
  const headerLimit = Number(getHeaderValue(headers, "x-notification-limit"));
  const hasMore = getHeaderValue(headers, "x-has-more") === "true";

  return {
    limit: Number.isFinite(headerLimit) && headerLimit > 0 ? headerLimit : fallbackLimit,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}

function normalizeNotificationPage(
  body: GetNotificationsResponse | NotificationRow[] | NotificationPageData,
  headers: Record<string, unknown>,
  fallbackLimit: number
): NotificationPageData {
  const data = getEnvelopeData<NotificationRow[] | NotificationPageData | unknown>(body);

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    "notifications" in data
  ) {
    const page = data as Partial<NotificationPageData>;
    return {
      notifications: Array.isArray(page.notifications)
        ? page.notifications.filter(
            (item): item is NotificationRow => Boolean(item) && typeof item === "object"
          )
        : [],
      pagination:
        page.pagination ?? parseHeaderPagination(headers, fallbackLimit),
    };
  }

  return {
    notifications: getArrayData<NotificationRow>(body),
    pagination: parseHeaderPagination(headers, fallbackLimit),
  };
}

export async function getNotifications(params: {
  cursor?: string | null;
  limit?: number;
} = {}): Promise<NotificationPageData> {
  const limit = params.limit ?? 30;
  const { data, headers } = await api.get<
    GetNotificationsResponse | NotificationRow[] | NotificationPageData
  >("/notifications", {
    params: {
      limit,
      ...(params.cursor ? { cursor: params.cursor } : {}),
    },
  });

  return normalizeNotificationPage(
    data,
    headers as Record<string, unknown>,
    limit
  );
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get<UnreadCountResponse | { unread: number }>(
    "/notifications/count/unread"
  );
  const result = getEnvelopeData<{ unread: number }>(data);

  return Number(result.unread || 0);
}

export async function markAsRead(id: DbId): Promise<NotificationRow> {
  const { data } = await api.put<MarkNotificationReadResponse | NotificationRow>(
    `/notifications/${encodeId(id)}/read`
  );

  return getEnvelopeData<NotificationRow>(data);
}

export async function markAllAsRead(): Promise<void> {
  await api.put("/notifications/read-all");
}

export const notificationService = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getErrorMessage,
};
