"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { foodService } from "@/services/food.service";
import { formatFoodDate, getListingPrice } from "@/lib/food";
import type { FoodListingRow } from "@backend/contracts/api-contracts";

export default function FoodDetailPage() {
  const params = useParams<{ id: string }>();
  const [listing, setListing] = useState<FoodListingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    foodService
      .getFoodById(params.id)
      .then((result) => {
        if (active) setListing(result);
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
  }, [params.id]);

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          href="/food"
          className="inline-flex rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
        >
          Back to Food
        </Link>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
          </div>
        ) : listing ? (
          <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-zinc-950">
                  {String(listing.title ?? "Untitled food")}
                </h1>
                {listing.description && (
                  <p className="mt-2 text-sm text-zinc-600">
                    {String(listing.description)}
                  </p>
                )}
              </div>
              <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                {getListingPrice(listing)}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Quantity" value={listing.quantity} />
              <Info label="Remaining" value={listing.remaining_quantity} />
              <Info label="Status" value={listing.status} />
              <Info label="Pickup start" value={formatFoodDate(listing.pickup_start_time)} />
              <Info label="Pickup end" value={formatFoodDate(listing.pickup_end_time)} />
              <Info label="Provider" value={listing.provider_id} />
            </div>
          </section>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Listing not found.
          </div>
        )}
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-950">
        {value === null || value === undefined || value === "" ? "-" : String(value)}
      </p>
    </div>
  );
}
