import type { DbId, ReservationDetails, ReservationRow } from "@backend/contracts/api-contracts";

export type ReservationPaymentState =
  | "not_required"
  | "payment_pending"
  | "paid"
  | "failed"
  | "expired"
  | "refund_pending"
  | "refunded"
  | "refund_failed"
  | "unknown";

export type StoredPaymentSession = {
  orderId: string;
  paymentSessionId: string;
  reservationId: DbId;
  listingId?: DbId;
  createdAt: string;
};

const STORAGE_KEY = "food-waste.payment.sessions";

function readSessions(): StoredPaymentSession[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isStoredPaymentSession)
      : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: StoredPaymentSession[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function isStoredPaymentSession(value: unknown): value is StoredPaymentSession {
  if (!value || typeof value !== "object") return false;

  const session = value as Partial<StoredPaymentSession>;
  return Boolean(
    session.orderId &&
      session.paymentSessionId &&
      session.reservationId !== undefined &&
      session.createdAt
  );
}

export function savePaymentSession(session: Omit<StoredPaymentSession, "createdAt">) {
  const sessions = readSessions().filter(
    (item) =>
      item.orderId !== session.orderId &&
      String(item.reservationId) !== String(session.reservationId)
  );

  writeSessions([
    {
      ...session,
      createdAt: new Date().toISOString(),
    },
    ...sessions,
  ].slice(0, 10));
}

export function getPaymentSessionByOrderId(orderId: string | null) {
  if (!orderId) return null;
  return readSessions().find((session) => session.orderId === orderId) ?? null;
}

export function getPaymentSessionByReservationId(reservationId?: DbId | null) {
  if (reservationId === null || reservationId === undefined) return null;
  return (
    readSessions().find(
      (session) => String(session.reservationId) === String(reservationId)
    ) ?? null
  );
}

export function getReservationPaymentState(
  reservation: Pick<ReservationRow | ReservationDetails, "status" | "payment_status">
): ReservationPaymentState {
  const paymentStatus = String(reservation.payment_status ?? "").toLowerCase();
  const reservationStatus = String(reservation.status ?? "").toLowerCase();

  if (paymentStatus === "not_required") return "not_required";
  if (paymentStatus === "paid") return "paid";
  if (paymentStatus === "failed") return "failed";
  if (paymentStatus === "expired") return "expired";
  if (paymentStatus === "refund_pending") return "refund_pending";
  if (paymentStatus === "refunded") return "refunded";
  if (paymentStatus === "refund_failed") return "refund_failed";
  if (paymentStatus === "pending" || reservationStatus === "payment_pending") {
    return "payment_pending";
  }

  return "unknown";
}

export function getPaymentStateLabel(state: ReservationPaymentState) {
  const labels: Record<ReservationPaymentState, string> = {
    not_required: "No payment required",
    payment_pending: "Payment pending",
    paid: "Paid",
    failed: "Payment failed",
    expired: "Payment expired",
    refund_pending: "Refund pending",
    refunded: "Refunded",
    refund_failed: "Refund failed",
    unknown: "Payment unknown",
  };

  return labels[state];
}

export function getPaymentStateTone(state: ReservationPaymentState) {
  if (state === "paid") return "success";
  if (state === "refunded") return "success";
  if (state === "failed" || state === "expired" || state === "refund_failed") {
    return "error";
  }
  if (state === "payment_pending" || state === "refund_pending") return "warning";
  return "neutral";
}

export function isRetryablePaymentState(state: ReservationPaymentState) {
  return state === "payment_pending";
}
