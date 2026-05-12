import api from "@/lib/axios";
import { getErrorMessage } from "@/services/auth";
import type {
  DbId,
  GetNotificationsResponse,
  MarkNotificationReadResponse,
  NotificationRow,
  UnreadCountResponse,
} from "@backend/contracts/api-contracts";

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

export async function getNotifications(): Promise<NotificationRow[]> {
  const { data } = await api.get<GetNotificationsResponse | NotificationRow[]>(
    "/notifications"
  );

  return getArrayData<NotificationRow>(data);
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
