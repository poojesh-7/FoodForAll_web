import LocationMapPreview from "@/components/maps/LocationMapPreview";
import { formatFoodDate } from "@/lib/food";
import type { ReactNode } from "react";
import type { NGOReservationHistoryRow } from "@/services/ngo.service";

type NGOReservationCardProps = {
  reservation: NGOReservationHistoryRow;
  actions?: ReactNode;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getReservationPrice(reservation: NGOReservationHistoryRow) {
  if (reservation.is_free) return "Free";
  if (reservation.price === null || reservation.price === undefined) return "";
  return `Rs. ${String(reservation.price)}`;
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

function getReservationStatus(reservation: NGOReservationHistoryRow) {
  if (reservation.status === "cancelled") return "cancelled";
  if (reservation.status === "expired" || reservation.payment_status === "expired") {
    return "expired";
  }
  if (
    reservation.task_status === "delivered" ||
    reservation.status === "picked_up" ||
    Boolean(reservation.completed_at)
  ) {
    return "completed";
  }
  if (reservation.task_status === "picked_from_provider") {
    return "picked from provider";
  }
  if (reservation.task_status === "in_progress") return "volunteer started";
  if (reservation.task_status === "pending") return "pending";
  return String(reservation.status ?? "reserved").replace(/_/g, " ");
}

function getStatusClasses(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "volunteer started" || status === "picked from provider") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "cancelled" || status === "expired") {
    return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

export default function NGOReservationCard({
  reservation,
  actions,
}: NGOReservationCardProps) {
  const price = getReservationPrice(reservation);
  const status = getReservationStatus(reservation);
  const providerLatitude = toCoordinate(reservation.provider_latitude);
  const providerLongitude = toCoordinate(reservation.provider_longitude);
  const providerLocation =
    providerLatitude !== null && providerLongitude !== null
      ? {
          label: "Restaurant",
          latitude: providerLatitude,
          longitude: providerLongitude,
        }
      : null;

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-950">
                {reservation.title}
              </h2>
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                {getReservationDisplayId(reservation.id)}
              </span>
              <span
                className={`rounded-md border px-2 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                  status
                )}`}
              >
                {status}
              </span>
              {price && (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  {price}
                </span>
              )}
            </div>
            {reservation.description && (
              <p className="mt-2 line-clamp-2 text-sm text-zinc-600">
                {reservation.description}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Quantity</p>
            <p className="mt-1 text-zinc-950">
              {displayValue(reservation.quantity_reserved)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Pickup</p>
            <p className="mt-1 text-zinc-950">
              {displayValue(reservation.pickup_type)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Volunteer</p>
            <p className="mt-1 text-zinc-950">
              {displayValue(reservation.assigned_volunteer_id)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Pickup Ends</p>
            <p className="mt-1 text-zinc-950">
              {formatFoodDate(reservation.pickup_end_time)}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
          <div className="flex flex-col justify-between gap-2 sm:flex-row">
            <div>
              <p className="font-medium text-zinc-950">Provider</p>
              <p>{displayValue(reservation.provider_name)}</p>
              <p>{displayValue(reservation.provider_phone)}</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="font-medium text-zinc-950">Receive Code</p>
              <p>{displayValue(reservation.receive_code)}</p>
            </div>
          </div>
        </div>
      </div>

      {providerLocation && (
        <div className="space-y-3 border-t border-zinc-100 bg-zinc-50 p-4">
          <p className="text-sm font-medium text-zinc-950">Restaurant Location</p>
          <LocationMapPreview points={[providerLocation]} />
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <p className="text-sm text-zinc-600">
              {displayValue(reservation.provider_address)}
            </p>
            <a
              href={getGoogleMapsUrl(
                providerLocation.latitude,
                providerLocation.longitude
              )}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
            >
              Navigate
            </a>
          </div>
        </div>
      )}

      {actions && <div className="border-t border-zinc-100 p-4">{actions}</div>}
    </article>
  );
}
