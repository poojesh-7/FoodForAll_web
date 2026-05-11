import Link from "next/link";
import LocationMapPreview from "@/components/maps/LocationMapPreview";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import { formatFoodDate } from "@/lib/food";
import { getReservationPaymentState } from "@/lib/payment-flow";
import type {
  DbId,
  ProviderReservationRow,
  ReservationDetails,
  ReservationHistoryRow,
} from "@backend/contracts/api-contracts";

type ReservationLike =
  | ReservationHistoryRow
  | ReservationDetails
  | ProviderReservationRow;

type ReservationCardProps = {
  reservation: ReservationLike;
  href?: string;
  actions?: React.ReactNode;
  providerView?: boolean;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getReservationId(reservation: ReservationLike): DbId | undefined {
  return reservation.id;
}

function getReservationKind(reservation: ReservationLike): string {
  if ("reservation_kind" in reservation && reservation.reservation_kind) {
    return String(reservation.reservation_kind);
  }
  return reservation.pickup_type === "ngo" ? "ngo" : "user";
}

function toCoordinate(value: unknown) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function getGoogleMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
}

export default function ReservationCard({
  reservation,
  href,
  actions,
  providerView = false,
}: ReservationCardProps) {
  const id = getReservationId(reservation);
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
  const content = (
    <article className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            {displayValue(reservation.title)}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Reservation #{displayValue(id)}
          </p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
          {getReservationKind(reservation)}
        </span>
      </div>

      <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
        <p>Quantity: {displayValue(reservation.quantity_reserved)}</p>
        <p>Status: {displayValue(reservation.status)}</p>
        <p>Task: {displayValue(reservation.task_status)}</p>
        <p>Pickup type: {displayValue(reservation.pickup_type)}</p>
        <p className="flex items-center gap-2">
          <span>Payment:</span>
          <PaymentStatusBadge state={getReservationPaymentState(reservation)} />
        </p>
        <p>Pickup ends: {formatFoodDate(reservation.pickup_end_time)}</p>
        <p>Reserved: {formatFoodDate(reservation.reserved_at)}</p>
        <p>Assigned: {formatFoodDate(reservation.assigned_at)}</p>
        <p>Picked up: {formatFoodDate(reservation.picked_up_at)}</p>
        <p>Completed: {formatFoodDate(reservation.completed_at)}</p>
        {!providerView && <p>Pickup code: {displayValue(reservation.pickup_code)}</p>}
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="font-medium text-zinc-950">
            {providerView ? "Requester" : "Provider"}
          </p>
          <p className="text-zinc-600">
            {providerView && "requester_name" in reservation
              ? displayValue(reservation.requester_name)
              : displayValue(reservation.provider_name)}
          </p>
          <p className="text-zinc-600">
            {providerView && "requester_phone" in reservation
              ? displayValue(reservation.requester_phone)
              : displayValue(reservation.provider_phone)}
          </p>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="font-medium text-zinc-950">Volunteer</p>
          <p className="text-zinc-600">
            {displayValue(reservation.assigned_volunteer_name)}
          </p>
          <p className="text-zinc-600">
            {displayValue(reservation.assigned_volunteer_phone)}
          </p>
        </div>
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
            Open in Google Maps
          </a>
        </div>
      )}

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      {href && providerLocation && (
        <Link
          href={href}
          className="inline-flex rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
        >
          View Details
        </Link>
      )}
    </article>
  );

  if (href && !providerLocation) {
    return (
      <Link href={href} className="block transition hover:opacity-90">
        {content}
      </Link>
    );
  }

  return content;
}
