import Link from "next/link";
import { formatFoodDate } from "@/lib/food";
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

export default function ReservationCard({
  reservation,
  href,
  actions,
  providerView = false,
}: ReservationCardProps) {
  const id = getReservationId(reservation);
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
        <p>Payment: {displayValue(reservation.payment_status)}</p>
        <p>Pickup ends: {formatFoodDate(reservation.pickup_end_time)}</p>
        <p>Reserved: {formatFoodDate(reservation.reserved_at)}</p>
        <p>Assigned: {formatFoodDate(reservation.assigned_at)}</p>
        <p>Picked up: {formatFoodDate(reservation.picked_up_at)}</p>
        <p>Completed: {formatFoodDate(reservation.completed_at)}</p>
        <p>Pickup code: {displayValue(reservation.pickup_code)}</p>
        <p>Receive code: {displayValue(reservation.receive_code)}</p>
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

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="block transition hover:opacity-90">
        {content}
      </Link>
    );
  }

  return content;
}
