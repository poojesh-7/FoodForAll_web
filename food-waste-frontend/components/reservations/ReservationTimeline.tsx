import type { ReservationDetails, ReservationRow } from "@shared/contracts/api-contracts";

type ReservationTimelineProps = {
  reservation: ReservationRow | ReservationDetails;
};

const ngoSteps = [
  { key: "payment_pending", label: "Payment Pending" },
  { key: "reserved", label: "Reserved" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "Volunteer Started" },
  { key: "picked_from_provider", label: "Picked From Provider" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
  { key: "failed", label: "Failed" },
  { key: "expired", label: "Expired" },
];

const selfPickupSteps = [
  { key: "payment_pending", label: "Payment Pending" },
  { key: "reserved", label: "Reserved" },
  { key: "self_pickup", label: "Self Pickup" },
  { key: "picked_up", label: "Picked Up" },
  { key: "cancelled", label: "Cancelled" },
  { key: "failed", label: "Failed" },
  { key: "expired", label: "Expired" },
];

function getOperationalState(reservation: ReservationRow | ReservationDetails) {
  if (reservation.status === "payment_pending") return "payment_pending";
  if (reservation.status === "failed" || reservation.payment_status === "failed") {
    return "failed";
  }
  if (reservation.status === "expired" || reservation.payment_status === "expired") {
    return "expired";
  }
  if (reservation.status === "cancelled") return "cancelled";
  if (reservation.task_status === "delivered") return "delivered";
  if (reservation.status === "picked_up") return "picked_up";
  if (reservation.pickup_type === "self_pickup" && reservation.status === "reserved") {
    return "self_pickup";
  }
  if (reservation.task_status) return reservation.task_status;
  return reservation.status ?? "pending";
}

function getStepClasses({
  isCurrent,
  isDone,
  key,
}: {
  isCurrent: boolean;
  isDone: boolean;
  key: string;
}) {
  if (isCurrent) {
    if (key === "cancelled" || key === "failed" || key === "expired") {
      return "border-red-600 bg-red-600 text-white";
    }
    if (key === "picked_up" || key === "delivered") {
      return "border-emerald-600 bg-emerald-600 text-white";
    }
    return "border-zinc-950 bg-zinc-950 text-white";
  }

  if (isDone) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-500";
}

export default function ReservationTimeline({
  reservation,
}: ReservationTimelineProps) {
  const steps = reservation.pickup_type === "self_pickup" ? selfPickupSteps : ngoSteps;
  const currentState = getOperationalState(reservation);
  const currentIndex = steps.findIndex((step) => step.key === currentState);
  const safeIndex = currentIndex >= 0 ? currentIndex : 1;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold text-zinc-950 sm:text-base">Reservation Timeline</h2>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        {steps.map((step, index) => {
          const isDone = index <= safeIndex;
          const isCurrent = step.key === currentState;

          return (
            <div
              key={step.key}
              className={`flex min-h-10 items-center rounded-md border px-2 py-1.5 text-[11px] font-medium leading-tight sm:p-3 sm:text-sm ${getStepClasses({
                isCurrent,
                isDone,
                key: step.key,
              })}`}
            >
              {step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
