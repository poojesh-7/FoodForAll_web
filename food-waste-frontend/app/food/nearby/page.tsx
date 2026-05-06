"use client";

import { useState } from "react";
import Link from "next/link";
import FoodCard from "@/components/FoodCard";
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

  const search = async (nextForm = form) => {
    if (!nextForm.lat || !nextForm.lng) {
      setError("Latitude and longitude are required.");
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

      setResults(data);
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
              Search active food listings by location and radius.
            </p>
          </div>
          <Link
            href="/food"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            All Food
          </Link>
        </div>

        <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
          <input
            value={form.lat}
            inputMode="decimal"
            placeholder="Latitude"
            className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => setForm({ ...form, lat: event.target.value })}
          />
          <input
            value={form.lng}
            inputMode="decimal"
            placeholder="Longitude"
            className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => setForm({ ...form, lng: event.target.value })}
          />
          <input
            value={form.radius}
            inputMode="decimal"
            placeholder="Radius km"
            className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => setForm({ ...form, radius: event.target.value })}
          />
          <button
            onClick={() => search()}
            disabled={loading}
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Search
          </button>
          <button
            onClick={useCurrentLocation}
            disabled={loading}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          >
            Current
          </button>
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
            No nearby food found.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {results.map((listing) => (
              <FoodCard key={String(listing.id)} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
