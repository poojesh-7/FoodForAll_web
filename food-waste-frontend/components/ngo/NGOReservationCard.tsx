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

export default function NGOReservationCard({
  reservation,
  actions,
}: NGOReservationCardProps) {
  const price = getReservationPrice(reservation);
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
    <article className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            {reservation.title}
          </h2>
          {reservation.description && (
            <p className="mt-1 line-clamp-2 text-sm text-zinc-600">
              {reservation.description}
            </p>
          )}
        </div>
        {price && (
          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
            {price}
          </span>
        )}
      </div>

      <div className="grid gap-3 text-sm text-zinc-600 sm:grid-cols-2">
        <p>
          Quantity reserved:{" "}
          <span className="font-medium text-zinc-950">
            {displayValue(reservation.quantity_reserved)}
          </span>
        </p>
        <p>
          Reservation status:{" "}
          <span className="font-medium text-zinc-950">
            {displayValue(reservation.task_status)}
          </span>
        </p>
        <p>
          Pickup type:{" "}
          <span className="font-medium text-zinc-950">
            {displayValue(reservation.pickup_type)}
          </span>
        </p>
        <p>
          Created:{" "}
          <span className="font-medium text-zinc-950">
            {formatFoodDate(reservation.created_at)}
          </span>
        </p>
        <p>
          Receive code:{" "}
          <span className="font-medium text-zinc-950">
            {displayValue(reservation.receive_code)}
          </span>
        </p>
      </div>

      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
        <p className="font-medium text-zinc-950">Provider</p>
        <p>{displayValue(reservation.provider_name)}</p>
        <p>{displayValue(reservation.provider_phone)}</p>
        <p>{displayValue(reservation.provider_address)}</p>
      </div>

      {providerLocation && (
        <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div>
            <p className="font-medium text-zinc-950">Restaurant Location</p>
            <p className="text-sm text-zinc-600">
              {displayValue(reservation.provider_address)}
            </p>
          </div>
          <LocationMapPreview points={[providerLocation]} />
          <a
            href={getGoogleMapsUrl(
              providerLocation.latitude,
              providerLocation.longitude
            )}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          >
            Navigate to Restaurant
          </a>
        </div>
      )}

      {actions && <div className="border-t border-zinc-200 pt-4">{actions}</div>}
    </article>
  );
}
