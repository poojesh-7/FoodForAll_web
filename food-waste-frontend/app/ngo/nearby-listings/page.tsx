"use client";

import { useMemo, useState } from "react";
import FoodCard from "@/components/FoodCard";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ngoService } from "@/services/ngo.service";
import type { DbId, NearbyFoodListing } from "@backend/contracts/api-contracts";
import { useRouter } from "next/navigation";

type LocationForm = {
  lat: string;
  lng: string;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

function getListingQuantity(listing: NearbyFoodListing) {
  const quantity = Number(listing.remaining_quantity);
  return Number.isFinite(quantity) ? quantity : 0;
}

export default function NGONearbyListingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<LocationForm>({ lat: "", lng: "" });
  const [listings, setListings] = useState<NearbyFoodListing[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedReservations = useMemo(
    () =>
      listings
        .map((listing) => ({
          listing_id: listing.id,
          quantity: Number(quantities[String(listing.id)] ?? 0),
        }))
        .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0),
    [listings, quantities]
  );

  const totalSelected = selectedReservations.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const search = async (nextForm = form) => {
    if (!nextForm.lat || !nextForm.lng) {
      setError("Latitude and longitude are required.");
      return;
    }

    try {
      setLoading(true);
      setSearched(true);
      setError("");
      setSuccess("");
      const data = await ngoService.getNearbyListings({
        lat: nextForm.lat,
        lng: nextForm.lng,
      });
      setListings(data);
      setQuantities({});
    } catch (err) {
      const message = ngoService.getErrorMessage(err);
      if (isPendingVerificationError(message)) {
        router.push(pendingVerificationRoute);
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const useCurrentLocation = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      const position = await getCurrentPosition();
      const nextForm = {
        lat: String(position.coords.latitude),
        lng: String(position.coords.longitude),
      };
      setForm(nextForm);
      await search(nextForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please allow location access.");
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = (listingId: DbId, value: string, maxQuantity: number) => {
    const numeric = Number(value);
    const nextValue =
      value === ""
        ? ""
        : String(Math.min(Math.max(Number.isFinite(numeric) ? numeric : 0, 0), maxQuantity));

    setQuantities((current) => ({
      ...current,
      [String(listingId)]: nextValue,
    }));
  };

  const reserveSelected = async () => {
    if (selectedReservations.length === 0) {
      setError("Select at least one listing quantity.");
      return;
    }

    try {
      setReserving(true);
      setError("");
      setSuccess("");
      const result = await ngoService.bulkReserve({
        reservations: selectedReservations,
      });

      const reservedById = new Map(
        selectedReservations.map((item) => [String(item.listing_id), item.quantity])
      );

      setListings((current) =>
        current
          .map((listing) => {
            const reserved = reservedById.get(String(listing.id)) ?? 0;
            const remaining = getListingQuantity(listing) - reserved;
            return {
              ...listing,
              remaining_quantity: Math.max(remaining, 0),
            };
          })
          .filter((listing) => getListingQuantity(listing) > 0)
      );
      setQuantities({});
      setSuccess(
        result.payment
          ? "Reservation created. Payment handling is not part of this phase."
          : "Reservation created successfully."
      );
    } catch (err) {
      const message = ngoService.getErrorMessage(err);
      setError(
        message.includes("Not enough quantity") || message.includes("not found")
          ? `${message}. Refresh nearby listings before trying again.`
          : message
      );
    } finally {
      setReserving(false);
    }
  };

  return (
    <NGOShell
      title="Nearby Listings"
      description="Find active food listings within your NGO service radius and reserve in one flow."
    >
      <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_1fr_auto_auto]">
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

      {error && <NGOStateBlock title={error} tone="error" />}
      {success && <NGOStateBlock title={success} tone="success" />}

      {listings.length > 0 && (
        <section className="flex flex-col justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
          <p className="text-sm text-zinc-600">
            {selectedReservations.length} listings selected, {totalSelected} total items
          </p>
          <button
            onClick={reserveSelected}
            disabled={reserving || selectedReservations.length === 0}
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reserving ? "Reserving..." : "Reserve Selected"}
          </button>
        </section>
      )}

      {loading ? (
        <NGOStateBlock title="Loading nearby listings..." />
      ) : searched && listings.length === 0 ? (
        <NGOStateBlock
          title="No nearby listings found."
          description="Try your current location again or check back when providers post new food."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {listings.map((listing) => {
            const id = String(listing.id);
            const maxQuantity = getListingQuantity(listing);

            return (
              <FoodCard
                key={id}
                listing={listing}
                href={undefined}
                actions={
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <span>Quantity</span>
                    <input
                      value={quantities[id] ?? ""}
                      inputMode="numeric"
                      placeholder="0"
                      className="w-24 rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-950 outline-none focus:border-zinc-950"
                      onChange={(event) =>
                        updateQuantity(listing.id, event.target.value, maxQuantity)
                      }
                    />
                  </label>
                }
              />
            );
          })}
        </div>
      )}
    </NGOShell>
  );
}
