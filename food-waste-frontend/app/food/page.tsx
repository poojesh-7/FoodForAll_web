"use client";

import { useEffect, useState } from "react";
import FoodCard from "@/components/FoodCard";
import ListingDiscoveryControls from "@/components/ListingDiscoveryControls";
import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";
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
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-6 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              Food rescue marketplace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
              Discover good food that deserves another chance.
            </h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-text-secondary">
              Find fresh surplus from nearby restaurants, priced for a useful
              second moment.
            </p>
          </div>
          <Link
            href="/food/nearby"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong bg-surface px-4 text-sm font-semibold text-text-primary transition hover:border-brand hover:bg-brand-soft"
          >
            Explore nearby
          </Link>
        </header>

        {error && <OperationalFeedbackBlock title={error} tone="error" />}

        <ListingDiscoveryControls
          filters={filters}
          onChange={setFilters}
          variant="marketplace"
        />

        {!loading && !error && listings.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">{listings.length}</span>{" "}
              listings ready for pickup
            </p>
          </div>
        )}

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="overflow-hidden rounded-lg border border-border bg-surface"
                aria-label="Loading listing"
              >
                <div className="h-48 animate-pulse bg-surface-muted" />
                <div className="space-y-3 p-5">
                  <div className="h-5 w-3/4 animate-pulse rounded bg-surface-muted" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
                  <div className="h-8 w-1/3 animate-pulse rounded bg-surface-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="border-y border-border py-12 text-center">
            <p className="text-lg font-semibold text-text-primary">
              Nothing fresh nearby right now.
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
              Try a different category, distance, or pickup window to find the
              next listing.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {listings.map((listing) => (
              <FoodCard key={String(listing.id)} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
