"use client";

import LocationMapPreview from "@/components/maps/LocationMapPreview";
import { ReservationFoodImage } from "@/components/FoodImage";
import IdentityChip from "@/components/identity/IdentityChip";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import { MetaChip, SignalTile } from "@/components/reservations/ReservationHighlights";
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
  Ticket,
  Truck,
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

function getOptionalDisplayMetric(source: object, key: string) {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" || value === null
    ? value
    : undefined;
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

function getStatusTone(status: ReservationStatus) {
  if (status === "completed") return "emerald";
  if (status === "payment_pending" || status === "volunteer_started") return "amber";
  if (status === "picked_from_provider" || status === "reserved") return "sky";
  if (status === "cancelled" || status === "expired" || status === "failed") {
    return "red";
  }
  return "zinc";
}

function getProgressLabel(status: ReservationStatus) {
  if (status === "completed") return "Delivery complete";
  if (status === "picked_from_provider") return "Volunteer is delivering to your NGO";
  if (status === "volunteer_started") return "Volunteer is at the provider pickup stage";
  if (status === "pending") return "Waiting for volunteer assignment";
  if (status === "payment_pending") return "Finish payment to keep this reservation";
  if (status === "cancelled") return "Reservation cancelled";
  if (status === "expired") return "Reservation expired";
  if (status === "failed") return "Reservation failed";
  return "Reserved and ready for rescue coordination";
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
      <ReservationFoodImage source={reservation} />
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-snug text-zinc-950">
                {reservation.title}
              </h2>
              <MetaChip label={getReservationDisplayId(reservation.id)} />
              <MetaChip label={displayValue(reservation.pickup_type)} />
              {price && (
                <MetaChip label={price} tone="emerald" />
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

        <div className="grid gap-3 md:grid-cols-3">
          <SignalTile
            icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            label="Status"
            value={getStatusLabel(status)}
            detail={getProgressLabel(status)}
            tone={getStatusTone(status)}
          />
          <SignalTile
            icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
            label="Receive Code"
            value={displayValue(reservation.receive_code)}
            detail="Give this to the volunteer at delivery."
            tone={reservation.receive_code ? "amber" : "zinc"}
          />
          <SignalTile
            icon={<Truck className="h-4 w-4" aria-hidden="true" />}
            label="Volunteer State"
            value={getVolunteerState(reservation, status)}
            detail={getProgressLabel(status)}
            tone={showVolunteer ? "sky" : "zinc"}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DetailItem
            icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Quantity"
            value={formatQuantityWithUnit(reservation.quantity_reserved, reservation)}
          />
          <DetailItem
            icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Ends"
            value={formatFoodDate(reservation.pickup_end_time)}
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
          <div className="space-y-2">
            <IdentityChip
              src={reservation.provider_profile_image_url}
              name={restaurantName}
              role="provider"
              label="Provider avatar"
              caption={displayValue(reservation.provider_phone)}
              rating={
                getOptionalDisplayMetric(reservation, "average_rating") ??
                getOptionalDisplayMetric(reservation, "averageRating")
              }
              reviewCount={
                getOptionalDisplayMetric(reservation, "total_reviews") ??
                getOptionalDisplayMetric(reservation, "totalReviews")
              }
            />
          </div>

          {showVolunteer && (
            <IdentityChip
              src={reservation.assigned_volunteer_profile_image_url}
              name={displayValue(reservation.assigned_volunteer_name)}
              role="volunteer"
              label="Volunteer avatar"
              caption={`${getVolunteerState(reservation, status)} - ${displayValue(
                reservation.assigned_volunteer_phone
              )}`}
              tone="amber"
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

      {actions && <div className="border-t border-zinc-100 p-4">{actions}</div>}
    </article>
  );
}
