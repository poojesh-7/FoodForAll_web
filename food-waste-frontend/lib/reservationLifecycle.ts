import type { ReservationDetails, ReservationHistoryRow } from "@shared/contracts/api-contracts";

export type ReservationLifecycleGroup = "active" | "history";
export type ReservationLifecycleStatus =
  | "active"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed"
  | "in_progress"
  | "payment_pending"
  | "reserved";

export type ReservationLifecycle = {
  group: ReservationLifecycleGroup;
  status: ReservationLifecycleStatus;
  reason: string;
};

export const ACTIVE_STATUSES = [
  "payment_pending",
  "pending",
  "reserved",
  "assigned",
  "volunteer_started",
  "ready_for_pickup",
  "pickup_in_progress",
  "in_progress",
  "picked_from_provider",
] as const;

export const HISTORY_STATUSES = [
  "abandoned_payment",
  "cancelled",
  "cancelled_before_confirmation",
  "completed",
  "delivered",
  "expired",
  "expired_payment",
  "failed",
  "payment_expired",
  "payment_failed",
  "picked_up",
  "timeout_cancelled",
] as const;

export const FAILED_STATUSES = [
  "abandoned_payment",
  "cancelled",
  "cancelled_before_confirmation",
  "expired",
  "expired_payment",
  "failed",
  "payment_expired",
  "payment_failed",
  "timeout_cancelled",
] as const;

export const FAILED_PAYMENT_STATUSES = [
  "abandoned",
  "cancelled",
  "expired",
  "failed",
  "refund_failed",
  "refund_pending",
  "refunded",
] as const;

const COMPLETED_RESERVATION_STATUSES = ["completed", "picked_up", "delivered"];
const COMPLETED_TASK_STATUSES = ["completed", "delivered", "picked_up"];
const ACTIVE_TASK_STATUSES = [
  "self_pickup",
  "pending",
  "assigned",
  "in_progress",
  "volunteer_started",
  "picked_from_provider",
];
const ACTIVE_PAYMENT_STATUSES = ["not_required", "paid", "pending", "success"];

type LifecycleReservation = Pick<
  ReservationDetails | ReservationHistoryRow,
  "completed_at" | "payment_expires_at" | "payment_status" | "status" | "task_status"
>;

export function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isExpiredPaymentHold(
  reservation: LifecycleReservation,
  now = Date.now()
) {
  const status = normalizeStatus(reservation.status);
  const paymentStatus = normalizeStatus(reservation.payment_status);
  if (
    status !== "payment_pending" ||
    paymentStatus !== "pending" ||
    !reservation.payment_expires_at
  ) {
    return false;
  }

  const expiresAtMs = new Date(reservation.payment_expires_at).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now;
}

export function classifyReservationLifecycle(
  reservation: LifecycleReservation,
  options: { now?: number } = {}
): ReservationLifecycle {
  const status = normalizeStatus(reservation.status);
  const taskStatus = normalizeStatus(reservation.task_status);
  const paymentStatus = normalizeStatus(reservation.payment_status);
  const now = options.now ?? Date.now();

  if (isExpiredPaymentHold(reservation, now)) {
    return {
      group: "history",
      status: "expired",
      reason: "payment_hold_expired",
    };
  }

  if (
    FAILED_STATUSES.includes(status as (typeof FAILED_STATUSES)[number]) ||
    FAILED_PAYMENT_STATUSES.includes(
      paymentStatus as (typeof FAILED_PAYMENT_STATUSES)[number]
    )
  ) {
    return {
      group: "history",
      status:
        status === "cancelled" || status === "cancelled_before_confirmation"
          ? "cancelled"
          : ["expired", "expired_payment", "payment_expired"].includes(status)
            ? "expired"
            : "failed",
      reason: "terminal_failure",
    };
  }

  if (
    COMPLETED_RESERVATION_STATUSES.includes(status) ||
    COMPLETED_TASK_STATUSES.includes(taskStatus) ||
    Boolean(reservation.completed_at)
  ) {
    return {
      group: "history",
      status: "completed",
      reason: "completed",
    };
  }

  if (
    ACTIVE_STATUSES.includes(status as (typeof ACTIVE_STATUSES)[number]) ||
    ACTIVE_TASK_STATUSES.includes(taskStatus) ||
    ACTIVE_PAYMENT_STATUSES.includes(paymentStatus)
  ) {
    if (taskStatus === "in_progress" || taskStatus === "assigned") {
      return {
        group: "active",
        status: "in_progress",
        reason: "active_task",
      };
    }

    if (status === "payment_pending" || paymentStatus === "pending") {
      return {
        group: "active",
        status: "payment_pending",
        reason: "pending_payment",
      };
    }

    return {
      group: "active",
      status: status === "reserved" ? "reserved" : "active",
      reason: "operational",
    };
  }

  return {
    group: "history",
    status: "failed",
    reason: "unknown_inactive_state",
  };
}

export function isActiveReservation(reservation: LifecycleReservation) {
  return classifyReservationLifecycle(reservation).group === "active";
}

export function isHistoricalReservation(reservation: LifecycleReservation) {
  return classifyReservationLifecycle(reservation).group === "history";
}
