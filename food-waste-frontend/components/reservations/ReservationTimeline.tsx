import type { ReservationDetails, ReservationRow } from "@backend/contracts/api-contracts";

type ReservationTimelineProps = {
  reservation: ReservationRow | ReservationDetails;
};

const steps = [
  { key: "payment_pending", label: "Payment Pending" },
  { key: "reserved", label: "Reserved" },
  { key: "pending", label: "Pending" },
  { key: "self_pickup", label: "Self Pickup" },
  { key: "in_progress", label: "Volunteer Started" },
  { key: "picked_from_provider", label: "Picked From Provider" },
  { key: "delivered", label: "Delivered" },
  { key: "picked_up", label: "Picked Up" },
  { key: "cancelled", label: "Cancelled" },
];

function getOperationalState(reservation: ReservationRow | ReservationDetails) {
  if (reservation.status === "payment_pending") return "payment_pending";
  if (reservation.status === "cancelled") return "cancelled";
  if (reservation.task_status === "delivered") return "delivered";
  if (reservation.status === "picked_up") return "picked_up";
  if (reservation.task_status) return reservation.task_status;
  return reservation.status ?? "pending";
}

export default function ReservationTimeline({
  reservation,
}: ReservationTimelineProps) {
  const currentState = getOperationalState(reservation);
  const currentIndex = steps.findIndex((step) => step.key === currentState);
  const safeIndex = currentIndex >= 0 ? currentIndex : 1;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-zinc-950">Reservation Timeline</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const isDone = index <= safeIndex;
          const isCurrent = step.key === currentState;

          return (
            <div
              key={step.key}
              className={`rounded-md border p-3 text-sm ${
                isCurrent
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : isDone
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-zinc-200 bg-zinc-50 text-zinc-500"
              }`}
            >
              {step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
