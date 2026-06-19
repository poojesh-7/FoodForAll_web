import Link from "next/link";
import { ArrowRight, Clock3, MapPin, Package, Store } from "lucide-react";
import FoodImage from "@/components/FoodImage";
import {
  formatFoodDate,
  formatQuantityWithUnit,
  formatDistanceKm,
  getListingId,
  getListingPrice,
  getRestaurantDisplayName,
  type FoodCardListing,
} from "@/lib/food";
import type { ReactNode } from "react";

type FoodCardProps = {
  listing: FoodCardListing;
  href?: string;
  actions?: ReactNode;
};

function getRemainingQuantity(listing: FoodCardListing) {
  return (
    listing.remaining_quantity ??
    ("quantity" in listing ? listing.quantity : undefined) ??
    "-"
  );
}

function getStatusClasses(status: string) {
  if (status === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "expired" || status === "inactive") {
    return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export default function FoodCard({ listing, href, actions }: FoodCardProps) {
  const id = getListingId(listing);
  const status = String(listing.status ?? "active").toLowerCase();
  const price = getListingPrice(listing);
  const providerName = getRestaurantDisplayName(listing);
  const distance = formatDistanceKm(listing);
  const content = (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:border-zinc-300 hover:shadow-md">
      <FoodImage source={listing} className="h-44" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug text-zinc-950">
              {String(listing.title ?? "Untitled food")}
            </h2>
            {"description" in listing && listing.description && (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
                {String(listing.description)}
              </p>
            )}
          </div>
          {price && (
            <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-950 px-2.5 py-1 text-sm font-semibold text-white">
              {price}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-md border px-2 py-1 text-xs font-semibold capitalize ${getStatusClasses(
              status
            )}`}
          >
            {status.replace(/_/g, " ")}
          </span>
          {distance && (
            <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {distance}
            </span>
          )}
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
              Remaining
            </div>
            <p className="mt-1 font-semibold text-zinc-950">
              {formatQuantityWithUnit(getRemainingQuantity(listing), listing)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:col-span-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              Pickup deadline
            </div>
            <p className="mt-1 font-semibold text-zinc-950">
              {"pickup_end_time" in listing
                ? formatFoodDate(listing.pickup_end_time)
                : "-"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white text-sm text-zinc-600">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border-r border-zinc-200 text-zinc-500">
            <Store className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 py-2 pr-3">
            <p className="truncate font-medium text-zinc-950">{providerName}</p>
            <p className="text-xs text-zinc-500">Restaurant</p>
          </div>
        </div>

        {actions ? (
          <div className="flex flex-wrap gap-2">{actions}</div>
        ) : (
          <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-4 text-sm font-semibold text-zinc-950">
            <span>Reserve pickup</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
      </div>
    </article>
  );

  if (!href && id && !actions) {
    href = `/food/${id}`;
  }

  return href ? (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  );
}
