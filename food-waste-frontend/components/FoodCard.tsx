import Link from "next/link";
import { ArrowRight, Clock3, MapPin, Package } from "lucide-react";
import FoodImage from "@/components/FoodImage";
import IdentityAvatar from "@/components/identity/IdentityAvatar";
import ReviewSummary from "@/components/ratings/ReviewSummary";
import {
  formatFoodDate,
  formatQuantityWithUnit,
  formatDistanceKm,
  getListingId,
  getListingPrice,
  getListingOriginalPrice,
  getListingSavings,
  getRestaurantDisplayName,
  type FoodCardListing,
} from "@/lib/food";
import {
  formatDietaryTag,
  formatFoodCategory,
  getDietaryTags,
} from "@/lib/listingDiscovery";
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
    return "bg-brand-soft text-brand-hover";
  }
  if (status === "expired" || status === "inactive") {
    return "bg-surface-muted text-text-secondary";
  }
  return "bg-amber-50 text-amber-800";
}

export default function FoodCard({ listing, href, actions }: FoodCardProps) {
  const id = getListingId(listing);
  const status = String(listing.status ?? "active").toLowerCase();
  const price = getListingPrice(listing);
  const originalPrice = getListingOriginalPrice(listing);
  const savings = getListingSavings(listing);
  const providerName = getRestaurantDisplayName(listing);
  const distance = formatDistanceKm(listing);
  const dietaryTags = getDietaryTags(listing);
  const content = (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-subtle transition hover:border-border-strong hover:shadow-card">
      <FoodImage source={listing} className="aspect-[4/3] h-auto min-h-48 sm:min-h-56" />
      <div className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-text-primary sm:text-xl">
            {String(listing.title ?? "Untitled food")}
          </h2>
          {"description" in listing && listing.description && (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-secondary">
              {String(listing.description)}
            </p>
          )}
        </div>

        <div className="flex items-end justify-between gap-3 border-y border-border py-4">
          <div className="min-w-0">
            {listing.is_free ? (
              <div className="text-3xl font-bold tracking-tight text-brand">FREE</div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
                  {price}
                </span>
                {originalPrice !== null && (
                  <span className="text-sm text-text-muted line-through">
                    Rs. {originalPrice.toFixed(2)}
                  </span>
                )}
              </div>
            )}
            {!listing.is_free && savings && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand-hover">
                  Save Rs. {savings.savingsAmount.toFixed(2)}
                </span>
                <span className="text-text-muted">{savings.percentage}% off</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3 text-sm text-text-secondary">
          <IdentityAvatar
            src={listing.provider_profile_image_url}
            name={providerName}
            role="provider"
            label="Provider avatar"
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate font-semibold text-text-primary">{providerName}</p>
            <div className="mt-0.5">
              <ReviewSummary summary={listing} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-text-primary">
            <Clock3 className="h-4 w-4 text-brand" aria-hidden="true" />
            {"pickup_end_time" in listing
              ? formatFoodDate(listing.pickup_end_time)
              : "Pickup time unavailable"}
          </span>
          <span className="text-text-muted" aria-hidden="true">·</span>
          <span className="flex items-center gap-1.5 text-text-secondary">
            <Package className="h-4 w-4 text-text-muted" aria-hidden="true" />
            {formatQuantityWithUnit(getRemainingQuantity(listing), listing)} remaining
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-md px-2 py-1 text-xs font-semibold capitalize ${getStatusClasses(
              status
            )}`}
          >
            {status.replace(/_/g, " ")}
          </span>
          {distance && (
            <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {distance}
            </span>
          )}
          <span className="rounded-md bg-surface-muted px-2 py-1 text-xs font-semibold text-text-secondary">
            {formatFoodCategory(String(listing.category ?? "other"))}
          </span>
          {dietaryTags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-brand-soft px-2 py-1 text-xs font-semibold text-brand-hover"
            >
              {formatDietaryTag(tag)}
            </span>
          ))}
          {dietaryTags.length > 2 && (
            <span className="rounded-md bg-surface-muted px-2 py-1 text-xs font-semibold text-text-secondary">
              +{dietaryTags.length - 2}
            </span>
          )}
        </div>

        {actions ? (
          <div className="flex flex-wrap gap-2">{actions}</div>
        ) : (
          <div className="mt-auto flex min-h-11 items-center justify-between rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover">
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
    <Link
      href={href}
      className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
