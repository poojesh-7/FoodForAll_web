"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FoodListingForm from "@/components/FoodListingForm";
import FoodImage from "@/components/FoodImage";
import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";
import { foodService } from "@/services/food.service";
import {
  formatFoodDate,
  getFinalPickupStartTime,
  getListingOriginalPrice,
  getListingSavings,
  getPrimaryImageUrl,
  getFoodValidationError,
  getReusableFoodFormValues,
  sanitizeFoodFormValues,
  type FoodFormValues,
} from "@/lib/food";
import { formatDietaryTag, formatFoodCategory, getDietaryTags } from "@/lib/listingDiscovery";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";
import type { FoodListingRow } from "@shared/contracts/api-contracts";

const initialValues: FoodFormValues = {
  title: "",
  description: "",
  quantity: "",
  quantity_unit: "Piece",
  custom_quantity_unit: "",
  category: "",
  dietary_tags: [],
  price: "",
  original_price: "",
  is_free: false,
  pickup_start_time: "",
  pickup_end_time: "",
  images: [],
};

function PreviousListingsModal({
  listings,
  loading,
  error,
  onClose,
  onUse,
}: {
  listings: FoodListingRow[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onUse: (listing: FoodListingRow) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-elevated"
        role="dialog"
        aria-modal="true"
        aria-labelledby="previous-listings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="previous-listings-title" className="text-lg font-bold text-text-primary">
              Previous listings
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Reuse details from a previous listing.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close previous listings"
            onClick={onClose}
            className="min-h-10 min-w-10 rounded-md border border-border-strong text-lg text-text-secondary transition hover:bg-surface-muted"
          >
            X
          </button>
        </div>

        {loading ? (
          <p className="mt-5 rounded-md border border-border bg-surface-muted p-4 text-sm text-text-secondary">
            Loading previous listings...
          </p>
        ) : error ? (
          <div className="mt-5">
            <OperationalFeedbackBlock title={error} tone="error" />
          </div>
        ) : listings.length === 0 ? (
          <p className="mt-5 rounded-md border border-border bg-surface-muted p-4 text-sm text-text-secondary">
            No previous listings found.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {listings.map((listing) => {
              const originalPrice = getListingOriginalPrice(listing);
              const savings = getListingSavings(listing);
              const dietaryTags = getDietaryTags(listing);
              const imageUrl = getPrimaryImageUrl(listing);

              return (
                <article
                  key={String(listing.id)}
                  className="flex gap-3 rounded-md border border-border p-3 transition hover:bg-surface-muted"
                >
                  {imageUrl && <FoodImage source={listing} className="h-20 w-20 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col justify-between gap-2 sm:flex-row">
                      <div>
                        <h3 className="font-semibold text-text-primary">
                          {String(listing.title ?? "Untitled food")}
                        </h3>
                        <p className="text-sm text-text-secondary">
                          {listing.is_free ? "Free" : `Rs. ${String(listing.price ?? "-")}`}
                          {originalPrice !== null && ` · Regular Rs. ${originalPrice.toFixed(2)}`}
                          {savings && ` · Save Rs. ${savings.savingsAmount.toFixed(2)}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUse(listing)}
                        className="min-h-10 rounded-md bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-hover"
                      >
                        Use this
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-muted">
                      <span>{formatFoodCategory(String(listing.category ?? "other"))}</span>
                      {dietaryTags.map((tag) => (
                        <span key={tag}>{formatDietaryTag(tag)}</span>
                      ))}
                      <span>{String(listing.quantity_unit ?? "Piece")}</span>
                      <span>{String(listing.status ?? "active")}</span>
                      <span>{formatFoodDate(listing.created_at as string | number | null)}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CreateProviderListingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [values, setValues] = useState<FoodFormValues>(initialValues);
  const imagesRef = useRef(values.images);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previousListingsOpen, setPreviousListingsOpen] = useState(false);
  const [previousListings, setPreviousListings] = useState<FoodListingRow[]>([]);
  const [previousListingsLoading, setPreviousListingsLoading] = useState(false);
  const [previousListingsError, setPreviousListingsError] = useState("");
  const [success, setSuccess] = useState("");

  const openPreviousListings = async () => {
    setPreviousListingsOpen(true);
    setPreviousListingsLoading(true);
    setPreviousListingsError("");

    try {
      const result = await foodService.getAllFood();
      setPreviousListings(
        result
          .filter((listing) => String(listing.provider_id) === String(user?.id))
          .sort(
            (left, right) =>
              new Date(String(right.created_at ?? 0)).getTime() -
              new Date(String(left.created_at ?? 0)).getTime()
          )
      );
    } catch (err) {
      setPreviousListingsError(foodService.getErrorMessage(err));
    } finally {
      setPreviousListingsLoading(false);
    }
  };

  useEffect(() => {
    imagesRef.current = values.images;
  }, [values.images]);

  useEffect(
    () => () => {
      imagesRef.current.forEach((image) => {
        if (image.file) URL.revokeObjectURL(image.previewUrl);
      });
    },
    []
  );

  const submit = async () => {
    if (loading) return;

    const sanitizedValues = sanitizeFoodFormValues(values);
    const finalPickupStartTime = getFinalPickupStartTime(
      sanitizedValues.pickup_start_time
    );
    const finalValues = {
      ...sanitizedValues,
      pickup_start_time: finalPickupStartTime,
    };
    const finalStartTime = new Date(finalPickupStartTime).getTime();
    const endTime = new Date(finalValues.pickup_end_time).getTime();
    const validationError =
      Number.isFinite(finalStartTime) &&
      Number.isFinite(endTime) &&
      endTime - finalStartTime < 30 * 60 * 1000
        ? "Pickup end time must be at least 30 minutes after the pickup start time."
        : getFoodValidationError(finalValues);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      setError("");

      await foodService.createFood({
        title: finalValues.title,
        description: finalValues.description || null,
        quantity: Number(finalValues.quantity),
        quantity_unit: finalValues.quantity_unit,
        custom_quantity_unit:
          finalValues.quantity_unit === "Other"
            ? finalValues.custom_quantity_unit
            : null,
        category: finalValues.category,
        dietary_tags: finalValues.dietary_tags,
        price: finalValues.is_free ? 0 : Number(finalValues.price),
        original_price: finalValues.is_free ? null : Number(finalValues.original_price),
        is_free: finalValues.is_free,
        pickup_start_time: new Date(finalValues.pickup_start_time).toISOString(),
        pickup_end_time: new Date(finalValues.pickup_end_time).toISOString(),
        images: finalValues.images
          .map((image) => image.file)
          .filter((file): file is File => Boolean(file)),
      });

      router.push("/provider/listings");
    } catch (err) {
      const message = foodService.getErrorMessage(err);
      if (isPendingVerificationError(message)) {
        router.push(pendingVerificationRoute);
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:px-6 lg:px-8">
      {previousListingsOpen && (
        <PreviousListingsModal
          listings={previousListings}
          loading={previousListingsLoading}
          error={previousListingsError}
          onClose={() => setPreviousListingsOpen(false)}
          onUse={(listing) => {
            setValues(getReusableFoodFormValues(listing));
            setPreviousListingsOpen(false);
            setSuccess("Previous listing loaded. You can edit the details before creating the listing.");
          }}
        />
      )}
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">Provider workspace</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-text-primary">Give this food another chance</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Add food details, pickup timing, and pricing in one calm workflow.
            </p>
          </div>
          <button
            type="button"
            onClick={openPreviousListings}
            className="min-h-10 rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold text-text-primary transition hover:bg-surface-muted"
          >
            Use a previous listing
          </button>
        </div>

        {error && <OperationalFeedbackBlock title={error} tone="error" />}
        {success && <OperationalFeedbackBlock title={success} tone="success" />}

        <FoodListingForm
          values={values}
          mode="create"
          loading={loading}
          onImageError={setError}
          onChange={setValues}
          onSubmit={submit}
        />
      </div>
    </main>
  );
}
