"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  MapPin,
  Navigation,
  Package,
  ShieldCheck,
  Store,
  Ticket,
  UserRound,
} from "lucide-react";
import LocationMapPreview from "@/components/maps/LocationMapPreview";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import { formatFoodDate, getRestaurantDisplayName } from "@/lib/food";
import {
  formatPaymentCountdown,
  getPaymentRemainingMs,
  getReservationPaymentState,
} from "@/lib/payment-flow";
import type {
  DbId,
  ProviderReservationRow,
  ReservationDetails,
  ReservationHistoryRow,
} from "@backend/contracts/api-contracts";
import { useEffect, useState, type ReactNode } from "react";

type ReservationLike =
  | ReservationHistoryRow
  | ReservationDetails
  | ProviderReservationRow;

type ReservationCardProps = {
  reservation: ReservationLike;
  href?: string;
  actions?: ReactNode;
  providerView?: boolean;
};

type OperationalStatus =
  | "payment_pending"
  | "reserved"
  | "pending"
  | "self_pickup"
  | "in_progress"
  | "picked_from_provider"
  | "completed"
  | "cancelled"
  | "failed"
  | "expired";

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getReservationId(reservation: ReservationLike): DbId | undefined {
  return reservation.id;
}

function getReservationDisplayId(id?: DbId) {
  const raw = String(id ?? "").replace(/-/g, "");
  return `RES-${(raw.slice(-4) || "----").toUpperCase()}`;
}

function toCoordinate(value: unknown) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function toMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: unknown) {
  return `Rs. ${toMoney(value).toFixed(2)}`;
}

function getGoogleMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
}

function getOperationalStatus(reservation: ReservationLike): OperationalStatus {
  const status = String(reservation.status ?? "").toLowerCase();
  const taskStatus = String(reservation.task_status ?? "").toLowerCase();
  const paymentStatus = String(reservation.payment_status ?? "").toLowerCase();

  if (status === "cancelled") return "cancelled";
  if (status === "failed" || paymentStatus === "failed") return "failed";
  if (status === "expired" || paymentStatus === "expired") return "expired";
  if (
    status === "picked_up" ||
    status === "delivered" ||
    taskStatus === "delivered" ||
    Boolean(reservation.completed_at)
  ) {
    return "completed";
  }
  if (taskStatus === "picked_from_provider") return "picked_from_provider";
  if (taskStatus === "in_progress" || taskStatus === "assigned") {
    return "in_progress";
  }
  if (status === "payment_pending" || paymentStatus === "pending") {
    return "payment_pending";
  }
  if (status === "pending" || taskStatus === "pending") return "pending";
  if (reservation.pickup_type === "self_pickup" && status === "reserved") {
    return "self_pickup";
  }
  return "reserved";
}

function getStatusLabel(status: OperationalStatus) {
  const labels: Record<OperationalStatus, string> = {
    payment_pending: "Payment Pending",
    reserved: "Reserved",
    pending: "Pending",
    self_pickup: "Ready for Pickup",
    in_progress: "In Progress",
    picked_from_provider: "Picked From Provider",
    completed: "Completed",
    cancelled: "Cancelled",
    failed: "Failed",
    expired: "Expired",
  };

  return labels[status];
}

function getStatusClasses(status: OperationalStatus) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "payment_pending" || status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "self_pickup" || status === "picked_from_provider") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "cancelled" || status === "failed" || status === "expired") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "in_progress") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function isPickupUrgent(reservation: ReservationLike, status: OperationalStatus) {
  if (
    status === "completed" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "expired" ||
    !reservation.pickup_end_time
  ) {
    return false;
  }

  const pickupEnd = new Date(reservation.pickup_end_time).getTime();
  return Number.isFinite(pickupEnd) && pickupEnd - Date.now() <= 60 * 60 * 1000;
}

function DetailItem({
  icon,
  label,
  value,
  emphasis = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        emphasis
          ? "border-amber-200 bg-amber-50"
          : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function usePaymentCountdown(reservation: ReservationLike, enabled: boolean) {
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
              Food quantity is temporarily reserved for you. If payment is not
              completed within 10 minutes, the reservation will expire
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

export default function ReservationCard({
  reservation,
  href,
  actions,
  providerView = false,
}: ReservationCardProps) {
  const id = getReservationId(reservation);
  const status = getOperationalStatus(reservation);
  const paymentState = getReservationPaymentState(reservation);
  const paymentPending = paymentState === "payment_pending";
  const paymentRemainingMs = usePaymentCountdown(reservation, paymentPending);
  const providerLatitude = toCoordinate(reservation.provider_latitude);
  const providerLongitude = toCoordinate(reservation.provider_longitude);
  const providerLocation =
    !providerView && providerLatitude !== null && providerLongitude !== null
      ? {
          label: "Restaurant",
          latitude: providerLatitude,
          longitude: providerLongitude,
        }
      : null;
  const showVolunteer =
    !providerView &&
    reservation.pickup_type !== "self_pickup" &&
    (reservation.pickup_type === "ngo" ||
      Boolean(reservation.assigned_volunteer_name) ||
      Boolean(reservation.assigned_volunteer_phone));
  const pickupUrgent = isPickupUrgent(reservation, status);
  const depositAmount = toMoney(reservation.reliability_deposit_amount);
  const foodAmount = toMoney(reservation.food_amount);
  const showDeposit = depositAmount > 0;
  const restaurantName = getRestaurantDisplayName(reservation);

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-snug text-zinc-950">
                {displayValue(reservation.title)}
              </h2>
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                {getReservationDisplayId(id)}
              </span>
              <span
                className={`rounded-md border px-2 py-1 text-xs font-semibold ${getStatusClasses(
                  status
                )}`}
              >
                {getStatusLabel(status)}
              </span>
              {reservation.pickup_type === "self_pickup" && (
                <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                  Self Pickup
                </span>
              )}
            </div>
            {"description" in reservation && reservation.description && (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
                {String(reservation.description)}
              </p>
            )}
          </div>
          <PaymentStatusBadge state={paymentState} />
        </div>

        {paymentPending && (
          <PaymentPendingNotice remainingMs={paymentRemainingMs} />
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem
            icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Quantity"
            value={displayValue(reservation.quantity_reserved)}
          />
          <DetailItem
            icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Deadline"
            value={formatFoodDate(reservation.pickup_end_time)}
            emphasis={pickupUrgent}
          />
          <DetailItem
            icon={<Ticket className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Code"
            value={!providerView ? displayValue(reservation.pickup_code) : "-"}
            emphasis={!providerView && Boolean(reservation.pickup_code)}
          />
          <DetailItem
            icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Reserved"
            value={formatFoodDate(reservation.reserved_at ?? reservation.created_at)}
          />
          {showDeposit && (
            <DetailItem
              icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Refundable Deposit"
              value={
                <span>
                  {formatMoney(depositAmount)}
                  <span className="mt-1 block text-xs font-medium text-zinc-500">
                    {String(reservation.reliability_deposit_status ?? "held").replace(
                      /_/g,
                      " "
                    )}
                  </span>
                </span>
              }
              emphasis
            />
          )}
          {showDeposit && foodAmount > 0 && (
            <DetailItem
              icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Food Price"
              value={formatMoney(foodAmount)}
            />
          )}
        </div>

        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
              {providerView ? (
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Store className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {providerView ? "Requester" : "Restaurant"}
            </div>
            <p className="mt-2 font-semibold text-zinc-950">
              {providerView && "requester_name" in reservation
                ? displayValue(reservation.requester_name)
                : restaurantName}
            </p>
            <p className="mt-1 text-zinc-600">
              {providerView && "requester_phone" in reservation
                ? displayValue(reservation.requester_phone)
                : displayValue(reservation.provider_phone)}
            </p>
          </div>

          {showVolunteer && (
            <div className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                Volunteer
              </div>
              <p className="mt-2 font-semibold text-zinc-950">
                {displayValue(reservation.assigned_volunteer_name)}
              </p>
              <p className="mt-1 text-zinc-600">
                {displayValue(reservation.assigned_volunteer_phone)}
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

      {(actions || href) && (
        <div className="flex flex-col gap-2 border-t border-zinc-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          {actions ? <div className="text-sm text-zinc-600">{actions}</div> : <span />}
          {href && (
            <Link
              href={href}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-950"
            >
              Details
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
