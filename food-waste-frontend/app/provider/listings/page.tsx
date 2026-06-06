"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import ProviderReputation from "@/components/ratings/ProviderReputation";
import { formatFoodDate, getListingPrice, isFreeRescueListing } from "@/lib/food";
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
} from "@shared/contracts/api-contracts";
import { useRouter } from "next/navigation";

type ListingView = "active" | "history";

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isActiveListing(listing: FoodListingRow) {
  if (listing.is_deleted || listing.status === "deleted") return false;

  const status = String(listing.status ?? "active").toLowerCase();
  const pickupEnd = listing.pickup_end_time
    ? new Date(listing.pickup_end_time).getTime()
    : Number.NaN;
  const hasFuturePickup = Number.isFinite(pickupEnd) ? pickupEnd > Date.now() : true;
  const remaining = toNumber(listing.remaining_quantity ?? listing.quantity);

  return status === "active" && hasFuturePickup && remaining > 0;
}

function getListingStatusLabel(listing: FoodListingRow) {
  if (listing.is_deleted || listing.status === "deleted") return "archived";

  const status = String(listing.status ?? "active").toLowerCase();
  const pickupEnd = listing.pickup_end_time
    ? new Date(listing.pickup_end_time).getTime()
    : Number.NaN;

  if (status !== "active") return status.replace(/_/g, " ");
  if (Number.isFinite(pickupEnd) && pickupEnd <= Date.now()) return "expired";
  if (toNumber(listing.remaining_quantity ?? listing.quantity) <= 0) {
    return "completed";
  }
  return "active";
}

function formatReviewDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function ListingMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
      <p className="mt-1 text-sm text-zinc-600">{detail}</p>
    </article>
  );
}

function ListingReviews({
  ratings,
}: {
  ratings: ListingRating[];
}) {
  if (!ratings.length) {
    return <p className="text-sm text-zinc-600">No reviews for this listing yet.</p>;
  }

  return (
    <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
      {ratings.map((rating, index) => (
        <div
          key={String(
            rating.id ?? `${String(rating.name ?? "review")}-${rating.created_at}-${index}`
          )}
          className="p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-950">
              {rating.name || "Food saver"}
            </p>
            <p className="text-sm font-medium text-amber-700">
              {Number(rating.rating).toFixed(1)} / 5
            </p>
          </div>
          {rating.review && (
            <p className="mt-1 text-sm text-zinc-600">{rating.review}</p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            {formatReviewDate(rating.created_at)}
          </p>
        </div>
      ))}
    </div>
  );
}

function ArchiveListingModal({
  listing,
  loading,
  onCancel,
  onConfirm,
}: {
  listing: FoodListingRow | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!listing) return;

    cancelButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listing, loading, onCancel]);

  return (
    <AnimatePresence>
      {listing && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={() => {
            if (!loading) onCancel();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-listing-title"
            aria-describedby="archive-listing-description"
            className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <h2
                id="archive-listing-title"
                className="text-lg font-semibold text-zinc-950"
              >
                Archive this listing?
              </h2>
              <p className="mt-2 text-sm font-medium text-zinc-700">
                {String(listing.title ?? "Untitled food")}
              </p>
              <p
                id="archive-listing-description"
                className="mt-4 text-sm leading-6 text-zinc-600"
              >
                Archived listings are removed from public discovery but reservation,
                payment, review, penalty, and refund history remain preserved.
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Listings with active reservations or ongoing pickups cannot be
                archived.
              </p>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Archiving..." : "Archive Listing"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function ProviderListingsPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [listings, setListings] = useState<FoodListingRow[]>([]);
  const [ngos, setNgos] = useState<FoodNGOOption[]>([]);
  const [providerRatings, setProviderRatings] =
    useState<ProviderRatingSummary | null>(null);
  const [listingRatings, setListingRatings] = useState<Record<string, ListingRating[]>>({});
  const [selectedListingId, setSelectedListingId] = useState<DbId | null>(null);
  const [archiveListing, setArchiveListing] = useState<FoodListingRow | null>(null);
  const [selectedNGOId, setSelectedNGOId] = useState("");
  const [listingView, setListingView] = useState<ListingView>("active");
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
  const activeListings = useMemo(
    () => providerListings.filter(isActiveListing),
    [providerListings]
  );
  const historicalListings = useMemo(
    () => providerListings.filter((listing) => !isActiveListing(listing)),
    [providerListings]
  );
  const visibleListings =
    listingView === "active" ? activeListings : historicalListings;
  const totalRemaining = activeListings.reduce(
    (sum, listing) => sum + toNumber(listing.remaining_quantity ?? listing.quantity),
    0
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

  const archiveSelectedListing = async () => {
    if (!archiveListing?.id) return;
    const id = archiveListing.id;
    try {
      setActionLoading(true);
      setError("");
      setSuccess("");
      const archivedListing = await foodService.deleteFood(id);
      setListings((current) =>
        current.map((listing) =>
          String(listing.id) === String(id)
            ? archivedListing ?? {
                ...listing,
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                status: "deleted",
              }
            : listing
        )
      );
      setListingView("history");
      setArchiveListing(null);
      setSuccess("Listing archived successfully.");
    } catch (err) {
      const message = foodService.getErrorMessage(err);
      if (isPendingVerificationError(message)) {
        router.push(pendingVerificationRoute);
        return;
      }
      toast.error(message);
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const openNGORequest = async (id: DbId) => {
    const listing = listings.find((item) => String(item.id) === String(id));
    if (!listing || !isFreeRescueListing(listing)) {
      setError("NGO rescue is only available for free listings.");
      return;
    }

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
      <ArchiveListingModal
        listing={archiveListing}
        loading={actionLoading}
        onCancel={() => setArchiveListing(null)}
        onConfirm={archiveSelectedListing}
      />
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Provider Listings</h1>
            <p className="text-sm text-zinc-600">
              Manage active food availability first, then review inactive listings.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/provider/moderation-cases"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-950 transition hover:bg-white"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              Moderation
            </Link>
            <Link
              href="/provider/listings/create"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create
            </Link>
          </div>
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
          <section className="grid gap-3 lg:grid-cols-[1.2fr_repeat(3,1fr)]">
            <ProviderReputation summary={providerRatings} />
            <ListingMetric
              label="Active Listings"
              value={activeListings.length}
              detail="Visible in current operations"
            />
            <ListingMetric
              label="Remaining"
              value={totalRemaining}
              detail="Items still available"
            />
            <ListingMetric
              label="History"
              value={historicalListings.length}
              detail="Expired or completed listings"
            />
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
          <div className="space-y-4">
            <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-1">
                {(["active", "history"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setListingView(item)}
                    className={`min-h-10 flex-1 rounded px-3 text-sm font-medium transition ${
                      listingView === item
                        ? "bg-white text-zinc-950 shadow-sm"
                        : "text-zinc-600 hover:text-zinc-950"
                    }`}
                  >
                    {item === "active"
                      ? `Active (${activeListings.length})`
                      : `History (${historicalListings.length})`}
                  </button>
                ))}
              </div>
            </section>

            {visibleListings.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
                No {listingView === "active" ? "active" : "historical"} listings found.
              </div>
            ) : (
              <section className="grid gap-4 xl:grid-cols-2">
                {visibleListings.map((listing) => (
                  <article
                    key={String(listing.id)}
                    className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium uppercase text-zinc-500">
                          Listing
                        </p>
                        <span className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold capitalize text-zinc-700">
                          {getListingStatusLabel(listing)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-base font-semibold text-zinc-950">
                            {String(listing.title ?? "Untitled food")}
                          </h2>
                          {listing.description && (
                            <p className="mt-1 line-clamp-2 text-sm text-zinc-600">
                              {String(listing.description)}
                            </p>
                          )}
                        </div>
                        {getListingPrice(listing) && (
                          <span
                            className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${
                              isFreeRescueListing(listing)
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border border-amber-200 bg-amber-50 text-amber-800"
                            }`}
                          >
                            {getListingPrice(listing)}
                          </span>
                        )}
                      </div>

                      <div className="grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <p className="text-xs font-medium uppercase text-zinc-500">
                            Remaining
                          </p>
                          <p className="mt-1 text-zinc-950">
                            {String(listing.remaining_quantity ?? listing.quantity ?? "-")}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-zinc-500">
                            Quantity
                          </p>
                          <p className="mt-1 text-zinc-950">
                            {String(listing.quantity ?? "-")}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-zinc-500">
                            Pickup Ends
                          </p>
                          <p className="mt-1 text-zinc-950">
                            {formatFoodDate(listing.pickup_end_time)}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-zinc-600">
                        {isFreeRescueListing(listing)
                          ? "Donation listing: NGO rescue requests are available."
                          : "Paid listing: reserved for direct self-purchase."}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/provider/listings/edit/${String(listing.id)}`}
                          className={`rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950 ${
                            listing.is_deleted || listing.status === "deleted"
                              ? "pointer-events-none opacity-50"
                              : ""
                          }`}
                        >
                          Edit
                        </Link>
                        {isFreeRescueListing(listing) && (
                          <button
                            onClick={() => listing.id && openNGORequest(listing.id)}
                            disabled={!listing.id || actionLoading || !isActiveListing(listing)}
                            className="rounded-md border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 disabled:opacity-50"
                          >
                            Request NGO
                          </button>
                        )}
                        <button
                          onClick={() => setArchiveListing(listing)}
                          disabled={
                            !listing.id ||
                            actionLoading ||
                            listing.is_deleted ||
                            listing.status === "deleted"
                          }
                          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                        >
                          Archive
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-zinc-100 bg-zinc-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-zinc-950">
                          Reviews
                        </h2>
                        <span className="text-xs font-medium text-zinc-500">
                          {(listingRatings[String(listing.id)] ?? []).length} total
                        </span>
                      </div>
                      <ListingReviews
                        ratings={listingRatings[String(listing.id)] ?? []}
                      />
                    </div>
                  </article>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
