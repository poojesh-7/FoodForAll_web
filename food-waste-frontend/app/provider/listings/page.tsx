"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import FoodCard from "@/components/FoodCard";
import ProviderReputation from "@/components/ratings/ProviderReputation";
import ReviewList from "@/components/ratings/ReviewList";
import { mergeListingRows } from "@/lib/realtimeMerge";
import { foodService } from "@/services/food.service";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ratingService } from "@/services/rating.service";
import { useAuthStore } from "@/store/authStore";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  DbId,
  FoodListingRow,
  FoodNGOOption,
  ListingRating,
  ProviderRatingSummary,
} from "@backend/contracts/api-contracts";
import { useRouter } from "next/navigation";

export default function ProviderListingsPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [listings, setListings] = useState<FoodListingRow[]>([]);
  const [ngos, setNgos] = useState<FoodNGOOption[]>([]);
  const [providerRatings, setProviderRatings] =
    useState<ProviderRatingSummary | null>(null);
  const [listingRatings, setListingRatings] = useState<Record<string, ListingRating[]>>({});
  const [selectedListingId, setSelectedListingId] = useState<DbId | null>(null);
  const [selectedNGOId, setSelectedNGOId] = useState("");
  const [loading, setLoading] = useState(true);
  const [ngoLoading, setNgoLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const listingVersion = useRealtimeStore((state) => state.listingVersion);
  const listingsById = useRealtimeStore((state) => state.listings);

  const providerListings = useMemo(
    () =>
      listings.filter((listing) => String(listing.provider_id) === String(user?.id)),
    [listings, user?.id]
  );

  useEffect(() => {
    let active = true;

    async function loadListings() {
      try {
        setLoading(true);
        setError("");
        const result = await foodService.getAllFood();
        const ownedListings = result.filter(
          (listing) => String(listing.provider_id) === String(user?.id)
        );
        const [reputation, ratingPairs] = await Promise.all([
          user?.id
            ? ratingService.getProviderRatings(user.id)
            : Promise.resolve<ProviderRatingSummary | null>(null),
          Promise.all(
            ownedListings
              .filter((listing) => listing.id)
              .map(async (listing) => [
                String(listing.id),
                await ratingService.getListingRatings(listing.id as DbId),
              ] as const)
          ),
        ]);

        if (!active) return;
        setListings(result);
        setProviderRatings(reputation);
        setListingRatings(Object.fromEntries(ratingPairs));
      } catch (err) {
        if (active) setError(foodService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadListings();

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!listingVersion) return;
    queueMicrotask(() =>
      setListings((current) =>
        mergeListingRows<FoodListingRow>(current, listingsById)
      )
    );
  }, [listingVersion, listingsById]);

  const deleteListing = async (id: DbId) => {
    if (!confirm("Delete this listing?")) return;

    try {
      setActionLoading(true);
      setError("");
      setSuccess("");
      await foodService.deleteFood(id);
      setListings((current) =>
        current.filter((listing) => String(listing.id) !== String(id))
      );
      setSuccess("Listing deleted successfully.");
    } catch (err) {
      const message = foodService.getErrorMessage(err);
      if (isPendingVerificationError(message)) {
        router.push(pendingVerificationRoute);
        return;
      }
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const openNGORequest = async (id: DbId) => {
    try {
      setSelectedListingId(id);
      setSelectedNGOId("");
      setNgoLoading(true);
      setError("");
      setSuccess("");
      const result = await foodService.viewNGOs();
      setNgos(result);
    } catch (err) {
      const message = foodService.getErrorMessage(err);
      if (isPendingVerificationError(message)) {
        router.push(pendingVerificationRoute);
        return;
      }
      setError(message);
    } finally {
      setNgoLoading(false);
    }
  };

  const requestNGO = async () => {
    if (!selectedListingId || !selectedNGOId) {
      setError("Select an NGO first.");
      return;
    }

    try {
      setActionLoading(true);
      setError("");
      setSuccess("");
      await foodService.requestNGO(selectedListingId, { ngo_id: selectedNGOId });
      setSuccess("NGO request sent successfully.");
      setSelectedListingId(null);
      setSelectedNGOId("");
    } catch (err) {
      const message = foodService.getErrorMessage(err);
      if (isPendingVerificationError(message)) {
        router.push(pendingVerificationRoute);
        return;
      }
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Provider Listings</h1>
            <p className="text-sm text-zinc-600">Manage food listings from your restaurant.</p>
          </div>
          <Link
            href="/provider/listings/create"
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          >
            Create
          </Link>
          <Link
            href="/provider/reservations"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Reservations
          </Link>
        </div>

        {(error || success) && (
          <div className="space-y-2">
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {success}
              </p>
            )}
          </div>
        )}

        {selectedListingId && (
          <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-950">Request NGO</h2>
            {ngoLoading ? (
              <p className="text-sm text-zinc-600">Loading NGOs...</p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                <select
                  value={selectedNGOId}
                  onChange={(event) => setSelectedNGOId(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                >
                  <option value="">Select NGO</option>
                  {ngos.map((ngo) => (
                    <option key={String(ngo.id)} value={String(ngo.id)}>
                      {ngo.organization_name}
                      {ngo.urgent_flag ? " (urgent)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={requestNGO}
                  disabled={actionLoading || !selectedNGOId}
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send Request
                </button>
              </div>
            )}
          </section>
        )}

        {!loading && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-950">
              Provider Reputation
            </h2>
            <ProviderReputation summary={providerRatings} />
          </section>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
          </div>
        ) : providerListings.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No listings found.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {providerListings.map((listing) => (
              <div key={String(listing.id)} className="space-y-3">
                <FoodCard
                  listing={listing}
                  href={undefined}
                  actions={
                    <>
                      <Link
                        href={`/provider/listings/edit/${String(listing.id)}`}
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => listing.id && openNGORequest(listing.id)}
                        disabled={!listing.id || actionLoading}
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950 disabled:opacity-50"
                      >
                        Request NGO
                      </button>
                      <button
                        onClick={() => listing.id && deleteListing(listing.id)}
                        disabled={!listing.id || actionLoading}
                        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </>
                  }
                />
                <ReviewList
                  ratings={listingRatings[String(listing.id)] ?? []}
                  emptyMessage="No reviews for this listing yet."
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
