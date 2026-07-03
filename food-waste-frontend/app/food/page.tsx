"use client";

import { useEffect, useState } from "react";
import FoodCard from "@/components/FoodCard";
import ListingDiscoveryControls from "@/components/ListingDiscoveryControls";
import { isNormalUserPaidListing } from "@/lib/food";
import {
  defaultListingDiscoveryFilters,
  getDiscoveryParams,
  type ListingDiscoveryFilters,
} from "@/lib/listingDiscovery";
import { mergeListingRows } from "@/lib/realtimeMerge";
import { foodService } from "@/services/food.service";
import { useAuthStore } from "@/store/authStore";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  FoodListingRow,
  FoodListingWithDistance,
} from "@shared/contracts/api-contracts";
import Link from "next/link";

type MarketplaceListing = FoodListingRow | FoodListingWithDistance;

function getProfileCoordinates(user: unknown): { lat: number; lng: number } | null {
  if (!user || typeof user !== "object") return null;

  const userObj = user as Record<string, unknown>;
  const latitude = Number(userObj.latitude);
  const longitude = Number(userObj.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { lat: latitude, lng: longitude };
}

async function getMarketplaceListings(
  filters: ListingDiscoveryFilters,
  user: unknown
) {
  const discoveryParams = getDiscoveryParams(filters);
  const coordinates = getProfileCoordinates(user);

  if (coordinates) {
    return foodService.getActiveFood({ ...coordinates, ...discoveryParams });
  }

  return foodService.getActiveFood(discoveryParams);
}

export default function FoodMarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [filters, setFilters] = useState(defaultListingDiscoveryFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const listingVersion = useRealtimeStore((state) => state.listingVersion);
  const listingsById = useRealtimeStore((state) => state.listings);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    getMarketplaceListings(filters, user)
      .then((result) => {
        if (active) {
          const realtimeListings = useRealtimeStore.getState().listings;
          setListings(
            mergeListingRows<MarketplaceListing>(
              result.filter(isNormalUserPaidListing),
              realtimeListings
            ).filter(
              (listing) =>
                isNormalUserPaidListing(listing) &&
                Number(listing.remaining_quantity ?? 0) > 0
            )
          );
        }
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
  }, [filters, user]);

  useEffect(() => {
    if (!listingVersion) return;
    queueMicrotask(() =>
      setListings((current) =>
        mergeListingRows<MarketplaceListing>(current, listingsById).filter(
          (listing) =>
            isNormalUserPaidListing(listing) &&
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
              Browse paid pickup reservations from nearby restaurants.
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

        <ListingDiscoveryControls
          filters={filters}
          onChange={setFilters}
        />

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
          </div>
        ) : listings.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No paid food reservations are available right now.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {listings.map((listing) => (
              <FoodCard key={String(listing.id)} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
