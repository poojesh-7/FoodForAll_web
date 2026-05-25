import LocationMapPreview from "@/components/maps/LocationMapPreview";
import { formatFoodDate } from "@/lib/food";
import {
  Clock3,
  MapPin,
  Navigation,
  Package,
  Store,
  Ticket,
  Truck,
} from "lucide-react";
import type {
  DbId,
  VolunteerCurrentTask,
  VolunteerTask,
} from "@shared/contracts/api-contracts";
import type { ReactNode } from "react";

type TaskLike = VolunteerTask | VolunteerCurrentTask;

type VolunteerTaskCardProps = {
  task: TaskLike;
  active?: boolean;
  action?: ReactNode;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getTaskId(task: TaskLike): DbId {
  return task.reservation_id;
}

function getReservationDisplayId(id: unknown) {
  const raw = String(id ?? "").replace(/-/g, "");
  return `RES-${(raw.slice(-4) || "----").toUpperCase()}`;
}

function getProviderDisplayName(task: TaskLike) {
  return displayValue(task.restaurant_name) !== "-"
    ? displayValue(task.restaurant_name)
    : displayValue(task.provider_name);
}

function getDistance(task: TaskLike) {
  if (!("distance" in task) || task.distance === undefined) return null;
  const distance = Number(task.distance);
  if (!Number.isFinite(distance)) return null;
  return distance > 100 ? `${(distance / 1000).toFixed(2)} km` : `${distance.toFixed(2)} km`;
}

function toCoordinate(value: unknown) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function getGoogleMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
}

function getStatusLabel(status: unknown) {
  return displayValue(status).replace(/_/g, " ");
}

function getStatusClasses(active: boolean, status: unknown) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "picked_from_provider") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (active || normalized === "in_progress") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function getProgressLabel(task: TaskLike) {
  if (task.task_status === "picked_from_provider") {
    return "Deliver to NGO and verify receive code";
  }
  if (task.task_status === "in_progress") {
    return "At restaurant pickup stage";
  }
  return "Ready to start";
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

export default function VolunteerTaskCard({
  task,
  active = false,
  action,
}: VolunteerTaskCardProps) {
  const distance = getDistance(task);
  const restaurantLatitude = toCoordinate(
    task.restaurant_latitude ?? task.latitude
  );
  const restaurantLongitude = toCoordinate(
    task.restaurant_longitude ?? task.longitude
  );
  const ngoLatitude = toCoordinate(task.ngo_latitude);
  const ngoLongitude = toCoordinate(task.ngo_longitude);
  const restaurantPoint =
    restaurantLatitude !== null && restaurantLongitude !== null
      ? {
          label: "Restaurant",
          latitude: restaurantLatitude,
          longitude: restaurantLongitude,
        }
      : null;
  const ngoPoint =
    ngoLatitude !== null && ngoLongitude !== null
      ? {
          label: "NGO",
          latitude: ngoLatitude,
          longitude: ngoLongitude,
        }
      : null;
  const mapPoints = [restaurantPoint, ngoPoint].filter(
    (point): point is NonNullable<typeof point> => Boolean(point)
  );
  const providerName = getProviderDisplayName(task);

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-snug text-zinc-950">
                {task.title}
              </h2>
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                {getReservationDisplayId(getTaskId(task))}
              </span>
              <span
                className={`rounded-md border px-2 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                  active,
                  task.task_status
                )}`}
              >
                {getStatusLabel(task.task_status)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DetailItem
            icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Quantity"
            value={displayValue(task.quantity_reserved)}
          />
          <DetailItem
            icon={<Truck className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Type"
            value={displayValue(task.pickup_type)}
          />
          <DetailItem
            icon={<Store className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Restaurant"
            value={providerName}
          />
          <DetailItem
            icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
            label="NGO"
            value={displayValue(task.ngo_name)}
          />
          <DetailItem
            icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Ends"
            value={formatFoodDate(task.pickup_end_time)}
          />
          {distance && (
            <DetailItem
              icon={<Navigation className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Distance"
              value={distance}
            />
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {"pickup_code" in task && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase text-amber-700">
                <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                Pickup Code
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-wide text-zinc-950">
                {displayValue(task.pickup_code)}
              </p>
            </div>
          )}
          <div className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
              <Truck className="h-3.5 w-3.5" aria-hidden="true" />
              Task Progress
            </div>
            <p className="mt-2 text-sm font-semibold text-zinc-950">
              {getProgressLabel(task)}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              Provider: {providerName}
              {task.provider_phone ? ` - ${task.provider_phone}` : ""}
            </p>
          </div>
        </div>
      </div>

      {mapPoints.length > 0 && (
        <div className="space-y-3 border-t border-zinc-100 bg-zinc-50 p-4">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
            <div>
              <p className="font-semibold text-zinc-950">Task Locations</p>
              <p className="text-sm text-zinc-600">
                Restaurant pickup and NGO delivery destination
              </p>
            </div>
          </div>
          <LocationMapPreview points={mapPoints} />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {restaurantPoint && (
              <a
                href={getGoogleMapsUrl(
                  restaurantPoint.latitude,
                  restaurantPoint.longitude
                )}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                Restaurant
              </a>
            )}
            {ngoPoint && (
              <a
                href={getGoogleMapsUrl(ngoPoint.latitude, ngoPoint.longitude)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-950"
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                NGO
              </a>
            )}
          </div>
        </div>
      )}

      {action && <div className="border-t border-zinc-100 p-4">{action}</div>}
    </article>
  );
}
