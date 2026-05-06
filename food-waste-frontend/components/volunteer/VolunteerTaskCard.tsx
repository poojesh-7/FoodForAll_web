import { formatFoodDate } from "@/lib/food";
import type {
  DbId,
  VolunteerCurrentTask,
  VolunteerTask,
} from "@backend/contracts/api-contracts";

type TaskLike = VolunteerTask | VolunteerCurrentTask;

type VolunteerTaskCardProps = {
  task: TaskLike;
  active?: boolean;
  action?: React.ReactNode;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getTaskId(task: TaskLike): DbId {
  return task.reservation_id;
}

function getDistance(task: TaskLike) {
  if (!("distance" in task) || task.distance === undefined) return null;
  const distance = Number(task.distance);
  if (!Number.isFinite(distance)) return null;
  return distance > 100 ? `${(distance / 1000).toFixed(2)} km` : `${distance.toFixed(2)} km`;
}

export default function VolunteerTaskCard({
  task,
  active = false,
  action,
}: VolunteerTaskCardProps) {
  const distance = getDistance(task);

  return (
    <article className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">{task.title}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Reservation #{String(getTaskId(task))}
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs font-medium ${
            active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-700"
          }`}
        >
          {task.task_status}
        </span>
      </div>

      <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
        <p>Quantity: {displayValue(task.quantity_reserved)}</p>
        <p>Pickup type: {displayValue(task.pickup_type)}</p>
        <p>Pickup ends: {formatFoodDate(task.pickup_end_time)}</p>
        {distance && <p>Distance: {distance}</p>}
        <p>Provider: {displayValue(task.provider_name)}</p>
        <p>Provider phone: {displayValue(task.provider_phone)}</p>
      </div>

      {"pickup_code" in task && (
        <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 sm:grid-cols-2">
          <p>
            Pickup code:{" "}
            <span className="font-medium text-zinc-950">
              {displayValue(task.pickup_code)}
            </span>
          </p>
          <p>
            Receive code:{" "}
            <span className="font-medium text-zinc-950">
              {displayValue(task.receive_code)}
            </span>
          </p>
        </div>
      )}

      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </article>
  );
}
