"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect, getRegistrationRedirect } from "@/lib/onboarding";
import {
  validateBusinessName,
  validateFssaiNumber,
  validateServiceRadius,
} from "@/lib/validation";
import { foodService } from "@/services/food.service";
import { useAuthStore } from "@/store/authStore";

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

function getUserPhone(user: ReturnType<typeof useAuthStore.getState>["user"]) {
  return user && "phone" in user && user.phone ? String(user.phone) : "";
}

export default function RestaurantRegisterPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const contactPhone = getUserPhone(user);

  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<RestaurantForm>({
    restaurant_name: "",
    fssai_number: "",
    service_radius_km: "5",
  });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (user && !contactPhone) {
      router.replace("/complete-profile");
    }
  }, [contactPhone, router, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current) return;

    if (!contactPhone) {
      setError("Complete profile with phone contact before provider onboarding.");
      router.replace("/complete-profile");
      return;
    }

    const restaurantError = validateBusinessName(
      form.restaurant_name,
      "Restaurant or provider name"
    );
    const fssaiError = validateFssaiNumber(form.fssai_number);
    const radiusError = validateServiceRadius(form.service_radius_km);

    if (restaurantError || fssaiError || radiusError) {
      setError(restaurantError || fssaiError || radiusError);
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

      const refreshedUser = await fetchMe({ allowStaleOnFailure: false });
      router.push(
        refreshedUser
          ? getPostAuthRedirect(refreshedUser)
          : getRegistrationRedirect("provider", result.restaurant.is_verified)
      );
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
        className="w-full max-w-lg space-y-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            Provider onboarding
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
            Provider Registration
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Complete verification to start sharing surplus food with nearby
            NGOs and users.
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <label
            htmlFor="contact_phone"
            className="block text-sm font-medium text-zinc-700"
          >
            Contact phone
          </label>
          <input
            id="contact_phone"
            value={contactPhone}
            readOnly
            className="w-full rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-zinc-950 outline-none"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="restaurant_name"
            className="block text-sm font-medium text-zinc-700"
          >
            Restaurant or provider name
          </label>
          <input
            id="restaurant_name"
            value={form.restaurant_name}
            placeholder="Registered food provider name"
            disabled={loading}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
            onChange={(event) =>
              setForm({ ...form, restaurant_name: event.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="fssai_number"
            className="block text-sm font-medium text-zinc-700"
          >
            FSSAI number
          </label>
          <input
            id="fssai_number"
            value={form.fssai_number}
            placeholder="Food safety license number"
            disabled={loading}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
            onChange={(event) =>
              setForm({ ...form, fssai_number: event.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="provider_service_radius_km"
            className="block text-sm font-medium text-zinc-700"
          >
            Service radius
          </label>
          <input
            id="provider_service_radius_km"
            value={form.service_radius_km}
            inputMode="decimal"
            placeholder="Service radius in km"
            disabled={loading}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
            onChange={(event) =>
              setForm({ ...form, service_radius_km: event.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="fssai_certificate"
            className="block text-sm font-medium text-zinc-700"
          >
            FSSAI certificate
          </label>
          <input
            id="fssai_certificate"
            type="file"
            accept="image/*,.pdf"
            disabled={loading}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 disabled:bg-zinc-100"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError("");
            }}
          />
          <p className="text-xs text-zinc-500">
            Upload an image or PDF for verification.
          </p>
        </div>

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
