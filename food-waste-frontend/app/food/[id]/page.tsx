"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProviderReputation from "@/components/ratings/ProviderReputation";
import ReviewList from "@/components/ratings/ReviewList";
import { foodService } from "@/services/food.service";
import { impactService } from "@/services/impact.service";
import { ratingService } from "@/services/rating.service";
import { formatFoodDate, getListingPrice } from "@/lib/food";
import type {
  FoodListingRow,
  ImpactSummary,
  ListingRating,
  ProviderRatingSummary,
} from "@backend/contracts/api-contracts";

export default function FoodDetailPage() {
  const params = useParams<{ id: string }>();
  const [listing, setListing] = useState<FoodListingRow | null>(null);
  const [listingImpact, setListingImpact] = useState<ImpactSummary | null>(null);
  const [ratings, setRatings] = useState<ListingRating[]>([]);
  const [providerRatings, setProviderRatings] =
    useState<ProviderRatingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadListing() {
      try {
        setLoading(true);
        setError("");
        const result = await foodService.getFoodById(params.id);
        const [impact, listingRatings, providerSummary] = await Promise.all([
          result.id
            ? impactService.getListingImpact(result.id)
            : Promise.resolve<ImpactSummary | null>(null),
          result.id
            ? ratingService.getListingRatings(result.id)
            : Promise.resolve<ListingRating[]>([]),
          result.provider_id
            ? ratingService.getProviderRatings(result.provider_id)
            : Promise.resolve<ProviderRatingSummary | null>(null),
        ]);

        if (!active) return;
        setListing(result);
        setListingImpact(impact);
        setRatings(listingRatings);
        setProviderRatings(providerSummary);
      } catch (err) {
        if (active) setError(foodService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadListing();

    return () => {
      active = false;
    };
  }, [params.id]);

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          href="/food"
          className="inline-flex rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
        >
          Back to Food
        </Link>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
          </div>
        ) : listing ? (
          <div className="space-y-4">
            <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold text-zinc-950">
                    {String(listing.title ?? "Untitled food")}
                  </h1>
                  {listing.description && (
                    <p className="mt-2 text-sm text-zinc-600">
                      {String(listing.description)}
                    </p>
                  )}
                </div>
                <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                  {getListingPrice(listing)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="Quantity" value={listing.quantity} />
                <Info label="Remaining" value={listing.remaining_quantity} />
                <Info label="Status" value={listing.status} />
                <Info label="Pickup start" value={formatFoodDate(listing.pickup_start_time)} />
                <Info label="Pickup end" value={formatFoodDate(listing.pickup_end_time)} />
                <Info label="Provider" value={listing.provider_id} />
                <Info label="Meals saved" value={listingImpact?.total_meals_saved} />
                <Info label="CO2 saved" value={listingImpact?.estimated_co2_saved} />
              </div>
            </section>

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Provider Reputation
              </h2>
              <ProviderReputation summary={providerRatings} />
            </div>

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">Reviews</h2>
              <ReviewList ratings={ratings} emptyMessage="No reviews for this listing yet." />
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Listing not found.
          </div>
        )}
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-950">
        {value === null || value === undefined || value === "" ? "-" : String(value)}
      </p>
    </div>
  );
}
