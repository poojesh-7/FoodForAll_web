import type { ReservationDetails } from "@shared/contracts/api-contracts";

type PickupCodeReservation = Pick<
  ReservationDetails,
  "pickup_code" | "pickup_type" | "status" | "pickup_start_time" | "pickup_end_time"
>;

type CancellationReservation = Pick<
  ReservationDetails,
  "pickup_type" | "status" | "pickup_end_time"
>;

export function isPickupCodeVisible(
  reservation: PickupCodeReservation,
  now = Date.now()
) {
  if (!reservation.pickup_code || reservation.pickup_type !== "self_pickup") {
    return false;
  }

  if (
    !["reserved", "ready_for_pickup", "pickup_in_progress"].includes(
      String(reservation.status ?? "").toLowerCase()
    )
  ) {
    return false;
  }

  const startAt = reservation.pickup_start_time
    ? new Date(reservation.pickup_start_time).getTime()
    : NaN;
  const endAt = reservation.pickup_end_time
    ? new Date(reservation.pickup_end_time).getTime()
    : NaN;

  return Number.isFinite(startAt) && Number.isFinite(endAt) && now >= startAt && now <= endAt;
}

export function getCancellationGuidance(
  reservation: CancellationReservation,
  now = Date.now()
) {
  if (
    reservation.pickup_type !== "self_pickup" ||
    String(reservation.status ?? "").toLowerCase() !== "reserved" ||
    !reservation.pickup_end_time
  ) {
    return null;
  }

  const pickupEndAt = new Date(reservation.pickup_end_time).getTime();
  if (!Number.isFinite(pickupEndAt)) return null;

  const cutoffAt = pickupEndAt - 20 * 60 * 1000;
  if (now >= cutoffAt) {
    return "Cancellation is unavailable within 20 minutes of pickup deadline.";
  }

  return "Cancel at least 20 minutes before the pickup deadline.";
}

export function getCancellationRemainingMs(
  reservation: CancellationReservation,
  now = Date.now()
) {
  if (
    reservation.pickup_type !== "self_pickup" ||
    String(reservation.status ?? "").toLowerCase() !== "reserved" ||
    !reservation.pickup_end_time
  ) {
    return null;
  }

  const pickupEndAt = new Date(reservation.pickup_end_time).getTime();
  if (!Number.isFinite(pickupEndAt)) return null;

  return Math.max(0, pickupEndAt - 20 * 60 * 1000 - now);
}

export function formatCancellationRemaining(ms: number | null) {
  if (ms === null) return null;
  if (ms <= 0) return "No time left";

  const totalMinutes = Math.ceil(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
