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

type PaymentRecoverableReservation = Pick<
  ReservationRow | ReservationDetails,
  "id" | "listing_id" | "order_id" | "payment_session_id" | "payment_expires_at" | "reserved_at"
>;

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

export function getPaymentSessionFromReservation(
  reservation?: PaymentRecoverableReservation | null
): StoredPaymentSession | null {
  if (!reservation?.id || !reservation.order_id || !reservation.payment_session_id) {
    return null;
  }

  return {
    orderId: reservation.order_id,
    paymentSessionId: reservation.payment_session_id,
    reservationId: reservation.id,
    listingId: reservation.listing_id,
    createdAt: String(reservation.reserved_at ?? new Date().toISOString()),
  };
}

export function getPaymentExpirationAt(
  reservation?: Pick<
    ReservationRow | ReservationDetails,
    "payment_expires_at" | "reserved_at" | "created_at"
  > | null
) {
  const explicitExpiry = reservation?.payment_expires_at
    ? new Date(reservation.payment_expires_at).getTime()
    : NaN;

  if (Number.isFinite(explicitExpiry)) return explicitExpiry;

  const holdStart = reservation?.reserved_at ?? reservation?.created_at;
  const holdStartMs = holdStart ? new Date(holdStart).getTime() : NaN;

  return Number.isFinite(holdStartMs) ? holdStartMs + 10 * 60 * 1000 : null;
}

export function getPaymentRemainingMs(
  reservation?: Pick<
    ReservationRow | ReservationDetails,
    "payment_expires_at" | "reserved_at" | "created_at"
  > | null
) {
  const expiresAt = getPaymentExpirationAt(reservation);
  return expiresAt ? Math.max(0, expiresAt - Date.now()) : null;
}

export function formatPaymentCountdown(ms: number | null) {
  if (ms === null) return "--:--";

  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function removePaymentSession(session: {
  orderId?: string | null;
  reservationId?: DbId | null;
}) {
  writeSessions(
    readSessions().filter(
      (item) =>
        (session.orderId ? item.orderId !== session.orderId : true) &&
        (session.reservationId !== null && session.reservationId !== undefined
          ? String(item.reservationId) !== String(session.reservationId)
          : true)
    )
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
