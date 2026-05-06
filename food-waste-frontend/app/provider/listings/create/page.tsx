"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FoodListingForm from "@/components/FoodListingForm";
import { foodService } from "@/services/food.service";
import {
  getFoodValidationError,
  type FoodFormValues,
} from "@/lib/food";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";

const initialValues: FoodFormValues = {
  title: "",
  description: "",
  quantity: "",
  price: "",
  is_free: true,
  pickup_start_time: "",
  pickup_end_time: "",
};

export default function CreateProviderListingPage() {
  const router = useRouter();

  const [values, setValues] = useState<FoodFormValues>(initialValues);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (loading) return;

    const validationError = getFoodValidationError(values);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      setError("");

      await foodService.createFood({
        title: values.title.trim(),
        description: values.description.trim() || null,
        quantity: Number(values.quantity),
        price: values.is_free ? 0 : Number(values.price),
        is_free: values.is_free,
        pickup_start_time: new Date(values.pickup_start_time).toISOString(),
        pickup_end_time: new Date(values.pickup_end_time).toISOString(),
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
          <h1 className="text-2xl font-semibold text-zinc-950">Create Listing</h1>
          <p className="text-sm text-zinc-600">
            Add surplus food with pickup timing and pricing.
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <FoodListingForm
          values={values}
          mode="create"
          loading={loading}
          onChange={setValues}
          onSubmit={submit}
        />
      </div>
    </main>
  );
}
