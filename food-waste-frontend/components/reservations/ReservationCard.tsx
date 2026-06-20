"use client";

import Link from "next/link";
import { ReservationFoodImage } from "@/components/FoodImage";
import IdentityChip from "@/components/identity/IdentityChip";
import { MetaChip, SignalTile } from "@/components/reservations/ReservationHighlights";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  MapPin,
  Navigation,
  Package,
  ShieldCheck,
  Ticket,
  Truck,
} from "lucide-react";
import LocationMapPreview from "@/components/maps/LocationMapPreview";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import {
  formatDistanceKm,
  formatFoodDate,
  formatQuantityWithUnit,
  getRestaurantDisplayName,
} from "@/lib/food";
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
} from "@shared/contracts/api-contracts";
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

function getOptionalDisplayMetric(source: object, key: string) {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" || value === null
    ? value
    : undefined;
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

function getStatusTone(status: OperationalStatus) {
  if (status === "completed") return "emerald";
  if (status === "payment_pending" || status === "pending") return "amber";
  if (status === "self_pickup" || status === "picked_from_provider") return "sky";
  if (status === "cancelled" || status === "failed" || status === "expired") {
    return "red";
  }
  return status === "in_progress" ? "amber" : "zinc";
}

function getTaskProgress(reservation: ReservationLike, status: OperationalStatus) {
  if (status === "completed") return "Pickup complete";
  if (status === "payment_pending") return "Finish payment to keep this reservation";
  if (status === "self_pickup") return "Bring pickup code to the provider";
  if (status === "in_progress") return "Volunteer pickup is underway";
  if (status === "picked_from_provider") return "Volunteer is delivering to NGO";
  if (status === "pending") return "Waiting for volunteer assignment";
  if (status === "cancelled") return "Reservation cancelled";
  if (status === "failed") return "Reservation failed";
  if (status === "expired") return "Reservation expired";
  return reservation.pickup_type === "ngo"
    ? "Reserved for NGO pickup"
    : "Ready for self pickup";
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
  const distance = formatDistanceKm(reservation);

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <ReservationFoodImage source={reservation} />
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-snug text-zinc-950">
                {displayValue(reservation.title)}
              </h2>
              <MetaChip label={getReservationDisplayId(id)} />
              {reservation.pickup_type === "self_pickup" && (
                <MetaChip label="Self Pickup" tone="sky" />
              )}
              {reservation.pickup_type === "ngo" && (
                <MetaChip label="NGO Pickup" tone="sky" />
              )}
              {distance && <MetaChip label={distance} icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />} />}
              <MetaChip
                label={`Reserved ${formatFoodDate(
                  reservation.reserved_at ?? reservation.created_at
                )}`}
                icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
              />
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

        <div className="grid gap-3 md:grid-cols-3">
          <SignalTile
            icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            label="Status"
            value={getStatusLabel(status)}
            detail={getTaskProgress(reservation, status)}
            tone={getStatusTone(status)}
          />
          {!providerView && (
            <SignalTile
              icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
              label="Pickup Code"
              value={displayValue(reservation.pickup_code)}
              detail="Share this at pickup."
              tone={reservation.pickup_code ? "amber" : "zinc"}
            />
          )}
          <SignalTile
            icon={<Truck className="h-4 w-4" aria-hidden="true" />}
            label={showVolunteer ? "Volunteer State" : "Task Progress"}
            value={
              showVolunteer
                ? displayValue(reservation.assigned_volunteer_name)
                : getStatusLabel(status)
            }
            detail={getTaskProgress(reservation, status)}
            tone={showVolunteer ? "sky" : getStatusTone(status)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem
            icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Quantity"
            value={formatQuantityWithUnit(reservation.quantity_reserved, reservation)}
          />
          <DetailItem
            icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Deadline"
            value={formatFoodDate(reservation.pickup_end_time)}
            emphasis={pickupUrgent}
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
          <div className="space-y-2">
            <IdentityChip
              src={
                providerView && "requester_profile_image_url" in reservation
                  ? String(reservation.requester_profile_image_url ?? "")
                  : reservation.provider_profile_image_url
              }
              name={
                providerView && "requester_name" in reservation
                  ? String(displayValue(reservation.requester_name))
                  : restaurantName
              }
              role={providerView ? (reservation.pickup_type === "ngo" ? "ngo" : "user") : "provider"}
              label={providerView ? "User avatar" : "Provider avatar"}
              caption={
                providerView && "requester_phone" in reservation
                  ? displayValue(reservation.requester_phone)
                  : displayValue(reservation.provider_phone)
              }
              rating={
                !providerView
                  ? getOptionalDisplayMetric(reservation, "average_rating") ??
                    getOptionalDisplayMetric(reservation, "averageRating")
                  : undefined
              }
              reviewCount={
                !providerView
                  ? getOptionalDisplayMetric(reservation, "total_reviews") ??
                    getOptionalDisplayMetric(reservation, "totalReviews")
                  : undefined
              }
            />
          </div>

          {showVolunteer && (
            <IdentityChip
              src={reservation.assigned_volunteer_profile_image_url}
              name={String(displayValue(reservation.assigned_volunteer_name))}
              role="volunteer"
              label="Volunteer avatar"
              caption={displayValue(reservation.assigned_volunteer_phone)}
            />
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
