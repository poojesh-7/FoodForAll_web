"use client";

import LocationMapPreview from "@/components/maps/LocationMapPreview";
import FoodImage from "@/components/FoodImage";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import {
  formatFoodDate,
  formatQuantityWithUnit,
  getRestaurantDisplayName,
} from "@/lib/food";
import {
  formatPaymentCountdown,
  getPaymentRemainingMs,
  getReservationPaymentState,
} from "@/lib/payment-flow";
import {
  AlertTriangle,
  Clock3,
  MapPin,
  Navigation,
  Package,
  ShieldCheck,
  Store,
  Ticket,
  Truck,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { NGOReservationHistoryRow } from "@/services/ngo.service";

type NGOReservationCardProps = {
  reservation: NGOReservationHistoryRow;
  actions?: ReactNode;
};

type ReservationStatus =
  | "payment_pending"
  | "reserved"
  | "pending"
  | "volunteer_started"
  | "picked_from_provider"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getReservationPrice(reservation: NGOReservationHistoryRow) {
  if (reservation.is_free) return "Free";
  if (reservation.price === null || reservation.price === undefined) return "";
  return `Rs. ${String(reservation.price)}`;
}

function toMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: unknown) {
  return `Rs. ${toMoney(value).toFixed(2)}`;
}

function getDepositStatusCopy(status: unknown) {
  const normalized = String(status ?? "held").toLowerCase();

  if (normalized === "refunded") return "Deposit refunded successfully.";
  if (normalized === "retained") return "Deposit retained due to failed pickup.";
  if (normalized === "refund_failed") return "Deposit refund needs attention.";
  if (normalized === "refund_pending") return "Refund is being processed.";

  return "Refund scheduled after successful rescue completion.";
}

function toCoordinate(value: unknown) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function getGoogleMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
}

function getReservationDisplayId(id: unknown) {
  const raw = String(id ?? "").replace(/-/g, "");
  return `RES-${(raw.slice(-4) || "----").toUpperCase()}`;
}

function getReservationStatus(reservation: NGOReservationHistoryRow): ReservationStatus {
  const status = String(reservation.status ?? "").toLowerCase();
  const taskStatus = String(reservation.task_status ?? "").toLowerCase();
  const paymentStatus = String(reservation.payment_status ?? "").toLowerCase();

  if (status === "cancelled") return "cancelled";
  if (status === "expired" || paymentStatus === "expired") return "expired";
  if (status === "failed" || paymentStatus === "failed") return "failed";
  if (status === "payment_pending" || paymentStatus === "pending") {
    return "payment_pending";
  }
  if (
    taskStatus === "delivered" ||
    status === "picked_up" ||
    Boolean(reservation.completed_at)
  ) {
    return "completed";
  }
  if (taskStatus === "picked_from_provider") return "picked_from_provider";
  if (taskStatus === "in_progress") return "volunteer_started";
  if (taskStatus === "pending") return "pending";
  return "reserved";
}

function getStatusLabel(status: ReservationStatus) {
  const labels: Record<ReservationStatus, string> = {
    reserved: "Reserved",
    payment_pending: "Payment Pending",
    pending: "Pending",
    volunteer_started: "Volunteer Started",
    picked_from_provider: "Picked From Provider",
    completed: "Completed",
    cancelled: "Cancelled",
    expired: "Expired",
    failed: "Failed",
  };

  return labels[status];
}

function getStatusClasses(status: ReservationStatus) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "payment_pending") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "volunteer_started" || status === "picked_from_provider") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "cancelled" || status === "expired" || status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function getVolunteerState(reservation: NGOReservationHistoryRow, status: ReservationStatus) {
  if (!reservation.assigned_volunteer_id) return "Not assigned";
  if (status === "completed") return "Delivered";
  if (status === "picked_from_provider") return "Picked from provider";
  if (status === "volunteer_started") return "Started pickup";
  return "Assigned";
}

function shouldShowVolunteer(reservation: NGOReservationHistoryRow, status: ReservationStatus) {
  return Boolean(
    reservation.assigned_volunteer_id ||
      reservation.assigned_volunteer_name ||
      reservation.assigned_volunteer_phone ||
      status === "volunteer_started" ||
      status === "picked_from_provider" ||
      status === "completed"
  );
}

function DetailItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function usePaymentCountdown(
  reservation: NGOReservationHistoryRow,
  enabled: boolean
) {
  const [remainingMs, setRemainingMs] = useState(() =>
    enabled ? getPaymentRemainingMs(reservation) : null
  );

  useEffect(() => {
    if (!enabled) return;

    const updateRemaining = () => setRemainingMs(getPaymentRemainingMs(reservation));
    const initialTimer = window.setTimeout(updateRemaining, 0);
    const timer = window.setInterval(updateRemaining, 1000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [enabled, reservation]);

  return enabled ? remainingMs ?? getPaymentRemainingMs(reservation) : null;
}

function PaymentPendingNotice({ remainingMs }: { remainingMs: number | null }) {
  const expired = remainingMs !== null && remainingMs <= 0;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              Your reservation is temporarily held while payment is pending.
            </p>
            <p className="mt-1 leading-6 text-amber-900">
              Food quantity is temporarily reserved for your NGO. If payment is
              not completed within 10 minutes, the reservation will expire
              automatically and stock will be restored.
            </p>
          </div>
        </div>
        <div className="rounded-md border border-amber-300 bg-white px-3 py-2 text-center">
          <p className="text-xs font-medium uppercase text-amber-700">
            {expired ? "Expiring" : "Expires In"}
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-zinc-950">
            {formatPaymentCountdown(remainingMs)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function NGOReservationCard({
  reservation,
  actions,
}: NGOReservationCardProps) {
  const price = getReservationPrice(reservation);
  const status = getReservationStatus(reservation);
  const paymentState = getReservationPaymentState(reservation);
  const paymentPending = paymentState === "payment_pending";
  const paymentRemainingMs = usePaymentCountdown(reservation, paymentPending);
  const providerLatitude = toCoordinate(reservation.provider_latitude);
  const providerLongitude = toCoordinate(reservation.provider_longitude);
  const showVolunteer = shouldShowVolunteer(reservation, status);
  const foodAmount = toMoney(reservation.food_amount);
  const depositAmount = toMoney(
    reservation.reliability_deposit_amount ?? reservation.refundable_deposit
  );
  const totalPaid = foodAmount + depositAmount;
  const showFinancials = foodAmount > 0 || depositAmount > 0;
  const providerLocation =
    providerLatitude !== null && providerLongitude !== null
      ? {
          label: "Restaurant",
          latitude: providerLatitude,
          longitude: providerLongitude,
        }
      : null;
  const restaurantName = getRestaurantDisplayName(reservation);

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <FoodImage
        source={reservation}
        className="h-48"
        showViewGalleryLink
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-snug text-zinc-950">
                {reservation.title}
              </h2>
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                {getReservationDisplayId(reservation.id)}
              </span>
              <span
                className={`rounded-md border px-2 py-1 text-xs font-semibold ${getStatusClasses(
                  status
                )}`}
              >
                {getStatusLabel(status)}
              </span>
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                {displayValue(reservation.pickup_type)}
              </span>
              {price && (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  {price}
                </span>
              )}
            </div>
            {reservation.description && (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
                {reservation.description}
              </p>
            )}
          </div>
          <PaymentStatusBadge state={paymentState} />
        </div>

        {paymentPending && (
          <PaymentPendingNotice remainingMs={paymentRemainingMs} />
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DetailItem
            icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Quantity"
            value={formatQuantityWithUnit(reservation.quantity_reserved, reservation)}
          />
          <DetailItem
            icon={<Truck className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Volunteer State"
            value={getVolunteerState(reservation, status)}
          />
          <DetailItem
            icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Ends"
            value={formatFoodDate(reservation.pickup_end_time)}
          />
          <DetailItem
            icon={<Ticket className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Receive Code"
            value={displayValue(reservation.receive_code)}
          />
        </div>

        {showFinancials && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-amber-700">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Operational Payment
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <p className="text-zinc-600">Food Amount</p>
                <p className="font-semibold text-zinc-950">
                  {formatMoney(foodAmount)}
                </p>
              </div>
              <div>
                <p className="text-zinc-600">Reliability Deposit</p>
                <p className="font-semibold text-amber-800">
                  {formatMoney(depositAmount)} refundable
                </p>
              </div>
              <div>
                <p className="text-zinc-600">Total Paid</p>
                <p className="font-semibold text-zinc-950">
                  {formatMoney(totalPaid)}
                </p>
              </div>
            </div>
            {depositAmount > 0 && (
              <p className="mt-3 text-xs font-medium leading-5 text-amber-900">
                {getDepositStatusCopy(
                  reservation.deposit_status ?? reservation.reliability_deposit_status
                )}
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
              <Store className="h-3.5 w-3.5" aria-hidden="true" />
              Restaurant
            </div>
            <p className="mt-2 font-semibold text-zinc-950">
              {restaurantName}
            </p>
            <p className="mt-1 text-zinc-600">
              {displayValue(reservation.provider_phone)}
            </p>
          </div>

          {showVolunteer && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase text-amber-700">
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                Volunteer
              </div>
              <p className="mt-2 font-semibold text-zinc-950">
                {displayValue(reservation.assigned_volunteer_name)}
              </p>
              <p className="mt-1 text-zinc-700">
                {displayValue(reservation.assigned_volunteer_phone)}
              </p>
              <p className="mt-2 text-xs font-medium text-amber-800">
                {getVolunteerState(reservation, status)}
              </p>
            </div>
          )}
        </div>
      </div>

      {providerLocation && (
        <div className="space-y-3 border-t border-zinc-100 bg-zinc-50 p-4">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Restaurant Location
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                {displayValue(reservation.provider_address)}
              </p>
            </div>
            <a
              href={getGoogleMapsUrl(
                providerLocation.latitude,
                providerLocation.longitude
              )}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
            >
              <Navigation className="h-4 w-4" aria-hidden="true" />
              Navigate
            </a>
          </div>
          <LocationMapPreview points={[providerLocation]} />
        </div>
      )}

      {actions && <div className="border-t border-zinc-100 p-4">{actions}</div>}
    </article>
  );
}
