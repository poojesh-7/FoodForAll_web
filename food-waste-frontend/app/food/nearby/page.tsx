"use client";

import { useState } from "react";
import Link from "next/link";
import { LocateFixed, MapPin, Search } from "lucide-react";
import FoodCard from "@/components/FoodCard";
import { isNormalUserPaidListing } from "@/lib/food";
import { foodService } from "@/services/food.service";
import type { FoodCardListing } from "@/lib/food";

type NearbyForm = {
  lat: string;
  lng: string;
  radius: string;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

export default function NearbyFoodPage() {
  const [form, setForm] = useState<NearbyForm>({
    lat: "",
    lng: "",
    radius: "5",
  });
  const [results, setResults] = useState<FoodCardListing[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [locationStatus, setLocationStatus] = useState("Location not set");

  const search = async (nextForm = form) => {
    if (!nextForm.lat || !nextForm.lng) {
      setError("Use current location or enter coordinates to search nearby.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setSearched(true);

      const data = await foodService.getNearbyFood({
        lat: nextForm.lat,
        lng: nextForm.lng,
        radius: nextForm.radius,
      });

      setResults(data.filter(isNormalUserPaidListing));
      setLocationStatus(`Searching within ${nextForm.radius || "5"} km`);
    } catch (err) {
      setError(foodService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const useCurrentLocation = async () => {
    try {
      setLoading(true);
      setError("");
      const position = await getCurrentPosition();
      const nextForm = {
        ...form,
        lat: String(position.coords.latitude),
        lng: String(position.coords.longitude),
      };
      setForm(nextForm);
      setLocationStatus("Using your current location");
      await search(nextForm);
    } catch {
      setError("Please allow location access.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Nearby Food</h1>
            <p className="text-sm text-zinc-600">
              Find paid pickup reservations around your location.
            </p>
          </div>
          <Link
            href="/food"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            All Food
          </Link>
        </div>

        <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex min-h-11 flex-1 items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
              <MapPin className="h-4 w-4 text-zinc-500" aria-hidden="true" />
              <span className="font-medium text-zinc-950">{locationStatus}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] md:min-w-[420px]">
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700">
                <span className="whitespace-nowrap font-medium">Radius</span>
                <input
                  value={form.radius}
                  inputMode="decimal"
                  aria-label="Search radius in kilometers"
                  className="min-w-0 flex-1 bg-transparent text-zinc-950 outline-none"
                  onChange={(event) =>
                    setForm({ ...form, radius: event.target.value })
                  }
                />
                <span className="text-zinc-500">km</span>
              </label>
              <button
                type="button"
                onClick={() => search()}
                disabled={loading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Search
              </button>
              <button
                type="button"
                onClick={useCurrentLocation}
                disabled={loading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-950 disabled:opacity-50"
              >
                <LocateFixed className="h-4 w-4" aria-hidden="true" />
                Current
              </button>
            </div>
          </div>

          <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-zinc-700">
              Enter location manually
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                value={form.lat}
                inputMode="decimal"
                placeholder="Latitude"
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-zinc-950 outline-none focus:border-zinc-950"
                onChange={(event) =>
                  setForm({ ...form, lat: event.target.value })
                }
              />
              <input
                value={form.lng}
                inputMode="decimal"
                placeholder="Longitude"
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-zinc-950 outline-none focus:border-zinc-950"
                onChange={(event) =>
                  setForm({ ...form, lng: event.target.value })
                }
              />
            </div>
          </details>
        </section>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
          </div>
        ) : searched && results.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No paid reservations found nearby.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {results.map((listing) => (
              <FoodCard key={String(listing.id)} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
