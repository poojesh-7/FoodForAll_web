import LocationMapPreview from "@/components/maps/LocationMapPreview";
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

function toCoordinate(value: unknown) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function getGoogleMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
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
        <p>NGO: {displayValue(task.ngo_name)}</p>
      </div>

      {"pickup_code" in task && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
          <p>
            Pickup code:{" "}
            <span className="font-medium text-zinc-950">
              {displayValue(task.pickup_code)}
            </span>
          </p>
        </div>
      )}

      {mapPoints.length > 0 && (
        <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div>
            <p className="font-medium text-zinc-950">Task Locations</p>
            <p className="text-sm text-zinc-600">
              Restaurant pickup and NGO delivery destination
            </p>
          </div>
          <LocationMapPreview points={mapPoints} />
          <div className="flex flex-wrap gap-2">
            {restaurantPoint && (
              <a
                href={getGoogleMapsUrl(
                  restaurantPoint.latitude,
                  restaurantPoint.longitude
                )}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              >
                Navigate to Restaurant
              </a>
            )}
            {ngoPoint && (
              <a
                href={getGoogleMapsUrl(ngoPoint.latitude, ngoPoint.longitude)}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Navigate to NGO
              </a>
            )}
          </div>
        </div>
      )}

      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </article>
  );
}
