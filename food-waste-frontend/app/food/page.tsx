"use client";

import { useEffect, useState } from "react";
import FoodCard from "@/components/FoodCard";
import { mergeListingRows } from "@/lib/realtimeMerge";
import { foodService } from "@/services/food.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { FoodListingRow } from "@backend/contracts/api-contracts";
import Link from "next/link";

export default function FoodMarketplacePage() {
  const [listings, setListings] = useState<FoodListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const listingVersion = useRealtimeStore((state) => state.listingVersion);
  const listingsById = useRealtimeStore((state) => state.listings);

  useEffect(() => {
    let active = true;

    foodService
      .getActiveFood()
      .then((result) => {
        if (active) setListings(result);
      })
      .catch((err) => {
        if (active) setError(foodService.getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!listingVersion) return;
    queueMicrotask(() =>
      setListings((current) =>
        mergeListingRows<FoodListingRow>(current, listingsById).filter(
          (listing) =>
            listing.status === "active" &&
            Number(listing.remaining_quantity ?? 0) > 0
        )
      )
    );
  }, [listingVersion, listingsById]);

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Food Marketplace</h1>
            <p className="text-sm text-zinc-600">
              Browse active food listings available for pickup.
            </p>
          </div>
          <Link
            href="/food/nearby"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Nearby
          </Link>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
          </div>
        ) : listings.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No active food listings found.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {listings.map((listing) => (
              <FoodCard key={String(listing.id)} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
