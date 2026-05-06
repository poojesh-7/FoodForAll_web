import Link from "next/link";
import { formatFoodDate, getListingId, getListingPrice, type FoodCardListing } from "@/lib/food";

type FoodCardProps = {
  listing: FoodCardListing;
  href?: string;
  actions?: React.ReactNode;
};

export default function FoodCard({ listing, href, actions }: FoodCardProps) {
  const id = getListingId(listing);
  const content = (
    <article className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            {String(listing.title ?? "Untitled food")}
          </h2>
          {"description" in listing && listing.description && (
            <p className="mt-1 line-clamp-2 text-sm text-zinc-600">
              {String(listing.description)}
            </p>
          )}
        </div>
        {getListingPrice(listing) && (
          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
            {getListingPrice(listing)}
          </span>
        )}
      </div>

      <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
        <p>
          Remaining:{" "}
          {String(
            listing.remaining_quantity ??
              ("quantity" in listing ? listing.quantity : undefined) ??
              "-"
          )}
        </p>
        {"status" in listing && <p>Status: {String(listing.status ?? "active")}</p>}
        {"pickup_end_time" in listing && (
          <p>Pickup ends: {formatFoodDate(listing.pickup_end_time)}</p>
        )}
        {"distance" in listing && listing.distance !== undefined && (
          <p>Distance: {Number(listing.distance).toFixed(2)} km</p>
        )}
      </div>

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </article>
  );

  if (!href && id && !actions) {
    href = `/food/${id}`;
  }

  return href ? (
    <Link href={href} className="block transition hover:opacity-90">
      {content}
    </Link>
  ) : (
    content
  );
}
