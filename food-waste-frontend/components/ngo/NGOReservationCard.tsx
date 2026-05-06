import { formatFoodDate } from "@/lib/food";
import type { NGOReservationHistoryRow } from "@/services/ngo.service";

type NGOReservationCardProps = {
  reservation: NGOReservationHistoryRow;
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

export default function NGOReservationCard({
  reservation,
}: NGOReservationCardProps) {
  const price = getReservationPrice(reservation);

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
          Pickup code:{" "}
          <span className="font-medium text-zinc-950">
            {displayValue(reservation.pickup_code)}
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
      </div>
    </article>
  );
}
