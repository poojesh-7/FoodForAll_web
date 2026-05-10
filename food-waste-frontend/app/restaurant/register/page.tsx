"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getRegistrationRedirect } from "@/lib/onboarding";
import { foodService } from "@/services/food.service";

type RestaurantForm = {
  restaurant_name: string;
  fssai_number: string;
  service_radius_km: string;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

export default function RestaurantRegisterPage() {
  const router = useRouter();

  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<RestaurantForm>({
    restaurant_name: "",
    fssai_number: "",
    service_radius_km: "5",
  });
  const [file, setFile] = useState<File | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current) return;

    if (!form.restaurant_name.trim() || !form.fssai_number.trim()) {
      setError("Restaurant name and FSSAI number are required.");
      return;
    }

    if (!file) {
      setError("FSSAI certificate is required.");
      return;
    }

    try {
      submittingRef.current = true;
      setLoading(true);
      setError("");

      const position = await getCurrentPosition();
      const result = await foodService.registerRestaurant({
        restaurant_name: form.restaurant_name.trim(),
        fssai_number: form.fssai_number.trim(),
        service_radius_km: form.service_radius_km,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        fssai_certificate: file,
      });

      router.push(getRegistrationRedirect("provider", result.restaurant.is_verified));
    } catch (err) {
      submittingRef.current = false;
      setLoading(false);
      setError(foodService.getErrorMessage(err));
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">Register Restaurant</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Submit your restaurant details for verification.
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <input
          value={form.restaurant_name}
          placeholder="Restaurant name"
          disabled={loading}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) =>
            setForm({ ...form, restaurant_name: event.target.value })
          }
        />

        <input
          value={form.fssai_number}
          placeholder="FSSAI number"
          disabled={loading}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) =>
            setForm({ ...form, fssai_number: event.target.value })
          }
        />

        <input
          value={form.service_radius_km}
          inputMode="decimal"
          placeholder="Service radius (km)"
          disabled={loading}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) =>
            setForm({ ...form, service_radius_km: event.target.value })
          }
        />

        <input
          type="file"
          accept="image/*,.pdf"
          disabled={loading}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError("");
          }}
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Submit for Verification"}
        </button>
      </form>
    </main>
  );
}
