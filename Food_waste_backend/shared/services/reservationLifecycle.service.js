const ACTIVE_RESERVATION_STATUSES = [
  "payment_pending",
  "pending",
  "reserved",
  "assigned",
  "volunteer_started",
  "ready_for_pickup",
  "pickup_in_progress",
  "in_progress",
  "picked_from_provider",
];

const COMPLETED_RESERVATION_STATUSES = [
  "completed",
  "picked_up",
  "delivered",
];

const FAILED_RESERVATION_STATUSES = [
  "abandoned_payment",
  "cancelled",
  "cancelled_before_confirmation",
  "expired",
  "expired_payment",
  "failed",
  "payment_expired",
  "payment_failed",
  "timeout_cancelled",
];

const ACTIVE_TASK_STATUSES = [
  "self_pickup",
  "pending",
  "assigned",
  "in_progress",
  "volunteer_started",
  "picked_from_provider",
];

const COMPLETED_TASK_STATUSES = [
  "completed",
  "delivered",
  "picked_up",
];

const ACTIVE_PAYMENT_STATUSES = [
  "not_required",
  "paid",
  "pending",
  "success",
];

const FAILED_PAYMENT_STATUSES = [
  "abandoned",
  "cancelled",
  "expired",
  "failed",
  "refund_failed",
  "refund_pending",
  "refunded",
];

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isExpiredPaymentHold(reservation, now = Date.now()) {
  const status = normalizeStatus(reservation?.status);
  const paymentStatus = normalizeStatus(reservation?.payment_status);
  const expiresAt = reservation?.payment_expires_at;
  if (status !== "payment_pending" || paymentStatus !== "pending" || !expiresAt) {
    return false;
  }

  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now;
}

function classifyReservationLifecycle(reservation, options = {}) {
  const status = normalizeStatus(reservation?.status);
  const taskStatus = normalizeStatus(reservation?.task_status);
  const paymentStatus = normalizeStatus(reservation?.payment_status);
  const now = Number(options.now || Date.now());

  if (isExpiredPaymentHold(reservation, now)) {
    return {
      group: "history",
      status: "expired",
      reason: "payment_hold_expired",
    };
  }

  if (
    FAILED_RESERVATION_STATUSES.includes(status) ||
    FAILED_PAYMENT_STATUSES.includes(paymentStatus)
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
    Boolean(reservation?.completed_at)
  ) {
    return {
      group: "history",
      status: "completed",
      reason: "completed",
    };
  }

  if (
    ACTIVE_RESERVATION_STATUSES.includes(status) ||
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

function sqlList(values) {
  return values.map((value) => `'${value}'`).join(", ");
}

function lifecycleSql(alias = "r") {
  const prefix = alias ? `${alias}.` : "";
  return `
    CASE
      WHEN ${prefix}status='payment_pending'
        AND ${prefix}payment_status='pending'
        AND ${prefix}payment_expires_at IS NOT NULL
        AND ${prefix}payment_expires_at <= NOW()
      THEN 'history'
      WHEN COALESCE(${prefix}status, '') IN (${sqlList(FAILED_RESERVATION_STATUSES)})
        OR COALESCE(${prefix}payment_status, '') IN (${sqlList(FAILED_PAYMENT_STATUSES)})
      THEN 'history'
      WHEN COALESCE(${prefix}status, '') IN (${sqlList(COMPLETED_RESERVATION_STATUSES)})
        OR COALESCE(${prefix}task_status, '') IN (${sqlList(COMPLETED_TASK_STATUSES)})
        OR ${prefix}completed_at IS NOT NULL
      THEN 'history'
      WHEN COALESCE(${prefix}status, '') IN (${sqlList(ACTIVE_RESERVATION_STATUSES)})
        OR COALESCE(${prefix}task_status, '') IN (${sqlList(ACTIVE_TASK_STATUSES)})
        OR COALESCE(${prefix}payment_status, '') IN (${sqlList(ACTIVE_PAYMENT_STATUSES)})
      THEN 'active'
      ELSE 'history'
    END
  `;
}

module.exports = {
  ACTIVE_PAYMENT_STATUSES,
  ACTIVE_RESERVATION_STATUSES,
  ACTIVE_TASK_STATUSES,
  COMPLETED_RESERVATION_STATUSES,
  COMPLETED_TASK_STATUSES,
  FAILED_PAYMENT_STATUSES,
  FAILED_RESERVATION_STATUSES,
  classifyReservationLifecycle,
  isExpiredPaymentHold,
  lifecycleSql,
  normalizeStatus,
};
