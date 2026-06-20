import LocationMapPreview from "@/components/maps/LocationMapPreview";
import { ReservationFoodImage } from "@/components/FoodImage";
import IdentityChip from "@/components/identity/IdentityChip";
import { MetaChip, SignalTile } from "@/components/reservations/ReservationHighlights";
import { formatFoodDate, formatQuantityWithUnit } from "@/lib/food";
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

function getStatusTone(active: boolean, status: unknown) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "picked_from_provider") return "amber";
  if (active || normalized === "in_progress") return "emerald";
  if (normalized === "delivered") return "emerald";
  return "sky";
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
      <ReservationFoodImage source={task} />
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-snug text-zinc-950">
                {task.title}
              </h2>
              <MetaChip label={getReservationDisplayId(getTaskId(task))} />
              <MetaChip label={displayValue(task.pickup_type)} />
              {distance && (
                <MetaChip
                  icon={<Navigation className="h-3.5 w-3.5" aria-hidden="true" />}
                  label={distance}
                />
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SignalTile
            icon={<Truck className="h-4 w-4" aria-hidden="true" />}
            label="Status"
            value={getStatusLabel(task.task_status)}
            detail={active ? "This is your active task." : "Available rescue task."}
            tone={getStatusTone(active, task.task_status)}
          />
          {"pickup_code" in task && (
            <SignalTile
              icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
              label="Pickup Code"
              value={displayValue(task.pickup_code)}
              detail="Share this with the provider."
              tone={task.pickup_code ? "amber" : "zinc"}
            />
          )}
          <SignalTile
            icon={<Truck className="h-4 w-4" aria-hidden="true" />}
            label="Task Progress"
            value={getProgressLabel(task)}
            detail={
              <>
                Provider: {providerName}
                {task.provider_phone ? ` - ${task.provider_phone}` : ""}
              </>
            }
            tone={getStatusTone(active, task.task_status)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DetailItem
            icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Quantity"
            value={formatQuantityWithUnit(task.quantity_reserved, task)}
          />
          <DetailItem
            icon={<Store className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Restaurant"
            value={
              <div className="space-y-2">
                <IdentityChip
                  src={task.provider_profile_image_url}
                  name={providerName}
                  role="provider"
                  label="Provider avatar"
                  caption={displayValue(task.provider_phone)}
                  rating={task.average_rating ?? task.averageRating}
                  reviewCount={task.total_reviews ?? task.totalReviews}
                />
              </div>
            }
          />
          <DetailItem
            icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
            label="NGO"
            value={
              <IdentityChip
                src={task.ngo_profile_image_url}
                name={displayValue(task.ngo_name)}
                role="ngo"
                label="NGO avatar"
              />
            }
          />
          <DetailItem
            icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Pickup Ends"
            value={formatFoodDate(task.pickup_end_time)}
          />
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
