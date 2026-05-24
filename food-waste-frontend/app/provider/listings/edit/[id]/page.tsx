"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import FoodListingForm from "@/components/FoodListingForm";
import { foodService } from "@/services/food.service";
import {
  formatFoodDate,
  getFoodValidationError,
  sanitizeFoodFormValues,
  toDateTimeLocal,
  type FoodFormValues,
} from "@/lib/food";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

const emptyValues: FoodFormValues = {
  title: "",
  description: "",
  quantity: "",
  price: "",
  is_free: true,
  pickup_start_time: "",
  pickup_end_time: "",
};

export default function EditProviderListingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const id = params.id;

  const [values, setValues] = useState<FoodFormValues>(emptyValues);
  const [pickupStartLabel, setPickupStartLabel] = useState("");
  const [canEditPricing, setCanEditPricing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    foodService
      .getFoodById(id)
      .then((listing) => {
        if (!active) return;

        if (String(listing.provider_id) !== String(user?.id)) {
          setError("You can only edit your own listings.");
          return;
        }

        setValues({
          title: String(listing.title ?? ""),
          description: String(listing.description ?? ""),
          quantity: String(listing.quantity ?? ""),
          price: String(listing.price ?? ""),
          is_free: Boolean(listing.is_free),
          pickup_start_time: toDateTimeLocal(listing.pickup_start_time),
          pickup_end_time: toDateTimeLocal(listing.pickup_end_time),
        });
        setPickupStartLabel(formatFoodDate(listing.pickup_start_time));
        setCanEditPricing(Number(listing.reservation_count ?? 0) === 0);
      })
      .catch((err) => setError(foodService.getErrorMessage(err)))
      .finally(() => {
        if (active) setInitialLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, user?.id]);

  const submit = async () => {
    if (loading) return;

    const sanitizedValues = sanitizeFoodFormValues(values);
    const validationError = getFoodValidationError(sanitizedValues, {
      includeQuantity: true,
      includePickupStart: false,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      setError("");

      await foodService.updateFood(id, {
        title: sanitizedValues.title,
        description: sanitizedValues.description || null,
        quantity: Number(sanitizedValues.quantity),
        price: sanitizedValues.is_free ? 0 : Number(sanitizedValues.price),
        is_free: sanitizedValues.is_free,
        pickup_end_time: new Date(sanitizedValues.pickup_end_time).toISOString(),
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
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">Edit Listing</h1>
          <p className="text-sm text-zinc-600">
            Update listing details and pickup timing.
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {initialLoading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
          </div>
        ) : (
          <FoodListingForm
            values={values}
            mode="edit"
            loading={loading}
            canEditPricing={canEditPricing}
            pickupStartLabel={pickupStartLabel}
            onChange={setValues}
            onSubmit={submit}
          />
        )}
      </div>
    </main>
  );
}
