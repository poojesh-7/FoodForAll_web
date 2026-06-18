"use client";

import { useEffect, useMemo, useState } from "react";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import PricingBreakdown from "@/components/payments/PricingBreakdown";
import {
  formatDistanceKm,
  formatFoodDate,
  formatQuantityWithUnit,
  getRescueRadiusKm,
  getRestaurantDisplayName,
  isOutsideRescueRadius,
} from "@/lib/food";
import { openCashfreeCheckout } from "@/lib/cashfree";
import { getReservationPaymentState, savePaymentSession } from "@/lib/payment-flow";
import { mergeListingRows } from "@/lib/realtimeMerge";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ngoService } from "@/services/ngo.service";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  DbId,
  NearbyFoodListing,
  ReservationPricingPreview,
} from "@shared/contracts/api-contracts";
import { useRouter } from "next/navigation";

const PAYMENT_POLL_ATTEMPTS = 8;
const PAYMENT_POLL_DELAY_MS = 1500;

type LocationForm = {
  lat: string;
  lng: string;
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

function isVisibleFreeListing(listing: NearbyFoodListing) {
  const status = String(listing.status ?? "active").toLowerCase();
  const isFree = listing.is_free === undefined || listing.is_free === true;
  const pickupEnd = listing.pickup_end_time
    ? new Date(listing.pickup_end_time).getTime()
    : Number.NaN;
  const pickupActive = Number.isFinite(pickupEnd) ? pickupEnd > Date.now() : true;

  return status === "active" && isFree && pickupActive && getListingQuantity(listing) > 0;
}

function getLocationStatus(form: LocationForm, searched: boolean) {
  if (!form.lat || !form.lng) return "No rescue location selected";
  if (searched) return "Nearby free listings loaded for this location";
  return "Rescue location ready";
}

function formatRadiusKm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

async function pollNGOPayment(reservationId: DbId) {
  for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS; attempt += 1) {
    const reservations = await ngoService.getReservations();
    const latest = reservations.find(
      (reservation) => String(reservation.id) === String(reservationId)
    );

    if (!latest) {
      await delay(PAYMENT_POLL_DELAY_MS);
      continue;
    }

    const state = getReservationPaymentState(latest);
    if (state === "paid" || state === "failed" || state === "expired") {
      return latest;
    }

    await delay(PAYMENT_POLL_DELAY_MS);
  }

  const reservations = await ngoService.getReservations();
  return (
    reservations.find(
      (reservation) => String(reservation.id) === String(reservationId)
    ) ?? null
  );
}

export default function NGONearbyListingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<LocationForm>({ lat: "", lng: "" });
  const [listings, setListings] = useState<NearbyFoodListing[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [pricingPreview, setPricingPreview] =
    useState<ReservationPricingPreview | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const listingVersion = useRealtimeStore((state) => state.listingVersion);
  const listingsById = useRealtimeStore((state) => state.listings);

  useEffect(() => {
    if (!listingVersion) return;
    queueMicrotask(() =>
      setListings((current) =>
        mergeListingRows<NearbyFoodListing>(current, listingsById).filter(
          isVisibleFreeListing
        )
      )
    );
  }, [listingVersion, listingsById]);

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

  useEffect(() => {
    if (selectedReservations.length === 0) {
      queueMicrotask(() => {
        setPricingPreview(null);
        setPricingLoading(false);
      });
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setPricingLoading(true);
      ngoService
        .previewBulkReserve({ reservations: selectedReservations })
        .then((preview) => {
          if (active) {
            setPricingPreview(preview);
            setError("");
          }
        })
        .catch((err) => {
          if (active) {
            setPricingPreview(null);
            setError(ngoService.getErrorMessage(err));
          }
        })
        .finally(() => {
          if (active) setPricingLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedReservations]);

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
      setListings(data.filter(isVisibleFreeListing));
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

      if (result.payment && result.reservations[0]?.id) {
        const reservationId = result.reservations[0].id;
        savePaymentSession({
          orderId: result.payment.order_id,
          paymentSessionId: result.payment.payment_session_id,
          reservationId,
        });
        const depositAmount = Number(
          result.payment.reliability_deposit_amount ?? result.policy?.depositAmount ?? 0
        );
        setSuccess(
          depositAmount > 0
            ? `Rs. ${depositAmount.toFixed(2)} refundable reliability deposit added. Complete payment to confirm this rescue.`
            : "Opening checkout to confirm this rescue."
        );
        const checkoutResult = await openCashfreeCheckout({
          paymentSessionId: result.payment.payment_session_id,
        });
        if (checkoutResult?.error?.message) {
          setSuccess("");
          await reservationService.cancelReservation(reservationId).catch(() => undefined);
          setError("Payment was not completed. Reservation was not created.");
          return;
        }

        setSuccess("Verifying payment status...");
        const verifiedReservation = await pollNGOPayment(reservationId);
        const paymentState = verifiedReservation
          ? getReservationPaymentState(verifiedReservation)
          : "failed";

        if (paymentState !== "paid") {
          setSuccess("");
          setError("Payment was not completed. Reservation was not created.");
          return;
        }

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
          depositAmount > 0
            ? `Rescue confirmed. Rs. ${depositAmount.toFixed(2)} refundable reliability deposit added. Deposit will be refunded automatically after successful rescue completion.`
            : "Rescue reservation confirmed."
        );
      } else {
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
        setSuccess("Reservation created successfully.");
      }
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
      <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">
              Rescue Location
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {getLocationStatus(form, searched)}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={useCurrentLocation}
              disabled={loading}
              className="min-h-10 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Locating..." : "Use Current Location"}
            </button>
            <button
              onClick={() => search()}
              disabled={loading || !form.lat || !form.lng}
              className="min-h-10 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
            >
              Refresh Listings
            </button>
          </div>
        </div>

        <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-zinc-700">
            Manual coordinates
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={form.lat}
              inputMode="decimal"
              placeholder="Latitude"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
              onChange={(event) => setForm({ ...form, lat: event.target.value })}
            />
            <input
              value={form.lng}
              inputMode="decimal"
              placeholder="Longitude"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
              onChange={(event) => setForm({ ...form, lng: event.target.value })}
            />
          </div>
        </details>
      </section>

      {error && <NGOStateBlock title={error} tone="error" />}
      {success && <NGOStateBlock title={success} tone="success" />}

      {listings.length > 0 && (
        <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:grid-cols-[1fr_28rem] lg:items-start">
          <div>
            <p className="text-sm font-medium text-zinc-950">
              {selectedReservations.length} listings selected
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              {totalSelected} total quantity selected for NGO rescue.
            </p>
          </div>
          <div className="space-y-3">
            {selectedReservations.length > 0 && (
              <PricingBreakdown
                role="ngo"
                foodAmount={pricingPreview?.foodAmount ?? 0}
                depositAmount={pricingPreview?.depositAmount ?? 0}
                totalAmount={pricingPreview?.totalAmount ?? 0}
                requiresDeposit={pricingPreview?.requiresDeposit}
                reservationCapacity={pricingPreview?.reservationCapacity}
                loading={pricingLoading}
              />
            )}
            <button
              onClick={reserveSelected}
              disabled={reserving || pricingLoading || selectedReservations.length === 0}
              className="min-h-10 w-full rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reserving
                ? "Reserving..."
                : pricingPreview?.totalAmount
                  ? `Reserve & Pay Rs. ${pricingPreview.totalAmount.toFixed(2)}`
                  : "Reserve Selected"}
            </button>
          </div>
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
        <div className="grid gap-4 xl:grid-cols-2">
          {listings.map((listing) => {
            const id = String(listing.id);
            const maxQuantity = getListingQuantity(listing);
            const distance = formatDistanceKm(listing);
            const rescueRadiusKm = getRescueRadiusKm(listing);
            const outsideRadius = isOutsideRescueRadius(listing);

            return (
              <article
                key={id}
                className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
              >
                <div className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-zinc-950">
                          {listing.title}
                        </h2>
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Free
                        </span>
                        <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                          Active
                        </span>
                        {distance && (
                          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                            {distance}
                          </span>
                        )}
                      </div>
                      {listing.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-zinc-600">
                          {listing.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Remaining
                      </p>
                      <p className="mt-1 text-zinc-950">
                        {formatQuantityWithUnit(maxQuantity, listing)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Pickup Deadline
                      </p>
                      <p className="mt-1 text-zinc-950">
                        {formatFoodDate(listing.pickup_end_time)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Restaurant
                      </p>
                      <p className="mt-1 text-zinc-950">
                        {getRestaurantDisplayName(listing)}
                      </p>
                    </div>
                  </div>

                  {outsideRadius && rescueRadiusKm !== null && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                      ⚠ Outside your rescue radius ({formatRadiusKm(rescueRadiusKm)} km)
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-between gap-3 border-t border-zinc-100 bg-zinc-50 p-4 sm:flex-row sm:items-center">
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <span className="font-medium">Quantity</span>
                    <input
                      value={quantities[id] ?? ""}
                      inputMode="numeric"
                      placeholder="0"
                      className="h-10 w-24 rounded-md border border-zinc-300 bg-white px-3 text-zinc-950 outline-none focus:border-zinc-950"
                      onChange={(event) =>
                        updateQuantity(listing.id, event.target.value, maxQuantity)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      updateQuantity(
                        listing.id,
                        quantities[id] ? "" : String(Math.min(maxQuantity, 10)),
                        maxQuantity
                      )
                    }
                    className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950"
                  >
                    {quantities[id] ? "Clear" : "Select"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </NGOShell>
  );
}
