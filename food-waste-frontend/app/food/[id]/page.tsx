"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ProviderReputation from "@/components/ratings/ProviderReputation";
import ReviewList from "@/components/ratings/ReviewList";
import { openCashfreeCheckout } from "@/lib/cashfree";
import { foodService } from "@/services/food.service";
import { impactService } from "@/services/impact.service";
import { ratingService } from "@/services/rating.service";
import { reservationService } from "@/services/reservation.service";
import { formatFoodDate, getListingPrice } from "@/lib/food";
import {
  getReservationPaymentState,
  savePaymentSession,
} from "@/lib/payment-flow";
import type {
  DbId,
  FoodListingRow,
  ImpactSummary,
  ListingRating,
  ReservationDetails,
  ProviderRatingSummary,
} from "@backend/contracts/api-contracts";

const PAYMENT_POLL_ATTEMPTS = 8;
const PAYMENT_POLL_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getRemainingQuantity(listing: FoodListingRow) {
  const remaining = Number(listing.remaining_quantity ?? listing.quantity ?? 0);
  return Number.isFinite(remaining) ? remaining : 0;
}

function getCheckoutRedirect(
  orderId: string,
  reservationId: DbId,
  route: "/payment-success" | "/payment-failed"
) {
  const params = new URLSearchParams({
    order_id: orderId,
    reservation_id: String(reservationId),
  });

  return `${route}?${params.toString()}`;
}

export default function FoodDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<FoodListingRow | null>(null);
  const [listingImpact, setListingImpact] = useState<ImpactSummary | null>(null);
  const [ratings, setRatings] = useState<ListingRating[]>([]);
  const [providerRatings, setProviderRatings] =
    useState<ProviderRatingSummary | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [reserving, setReserving] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadListing() {
      try {
        setLoading(true);
        setError("");
        const result = await foodService.getFoodById(params.id);
        const [impact, listingRatings, providerSummary] = await Promise.all([
          result.id
            ? impactService.getListingImpact(result.id)
            : Promise.resolve<ImpactSummary | null>(null),
          result.id
            ? ratingService.getListingRatings(result.id)
            : Promise.resolve<ListingRating[]>([]),
          result.provider_id
            ? ratingService.getProviderRatings(result.provider_id)
            : Promise.resolve<ProviderRatingSummary | null>(null),
        ]);

        if (!active) return;
        setListing(result);
        setListingImpact(impact);
        setRatings(listingRatings);
        setProviderRatings(providerSummary);
      } catch (err) {
        if (active) setError(foodService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadListing();

    return () => {
      active = false;
    };
  }, [params.id]);

  const pollReservationPayment = async (reservationId: DbId) => {
    let latest: ReservationDetails | null = null;

    for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS; attempt += 1) {
      latest = await reservationService.getReservationById(reservationId);
      const state = getReservationPaymentState(latest);

      if (state === "paid" || state === "failed" || state === "expired") {
        return latest;
      }

      await delay(PAYMENT_POLL_DELAY_MS);
    }

    return latest;
  };

  const reserveAndPay = async () => {
    if (!listing?.id) return;

    const quantityValue = Number(quantity);
    const maxQuantity = Math.min(getRemainingQuantity(listing), 2);

    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      setError("Enter a valid quantity.");
      return;
    }

    if (quantityValue > maxQuantity) {
      setError(`You can reserve up to ${maxQuantity} item${maxQuantity === 1 ? "" : "s"}.`);
      return;
    }

    try {
      setReserving(true);
      setError("");
      setCheckoutMessage("Creating reservation...");

      const result = await reservationService.createReservation({
        listing_id: listing.id,
        quantity: quantityValue,
      });

      if (!result.reservation.id) {
        throw new Error("Reservation created without an id.");
      }

      savePaymentSession({
        orderId: result.payment.order_id,
        paymentSessionId: result.payment.payment_session_id,
        reservationId: result.reservation.id,
        listingId: listing.id,
      });

      setCheckoutMessage("Opening secure Cashfree checkout...");
      const checkoutResult = await openCashfreeCheckout({
        paymentSessionId: result.payment.payment_session_id,
      });

      if (checkoutResult?.error?.message) {
        setCheckoutMessage(checkoutResult.error.message);
      } else {
        setCheckoutMessage("Verifying payment status...");
      }

      const verifiedReservation = await pollReservationPayment(result.reservation.id);
      const paymentState = verifiedReservation
        ? getReservationPaymentState(verifiedReservation)
        : "payment_pending";

      if (paymentState === "paid") {
        router.push(
          getCheckoutRedirect(
            result.payment.order_id,
            result.reservation.id,
            "/payment-success"
          )
        );
        return;
      }

      if (paymentState === "failed" || paymentState === "expired") {
        router.push(
          getCheckoutRedirect(
            result.payment.order_id,
            result.reservation.id,
            "/payment-failed"
          )
        );
        return;
      }

      setCheckoutMessage(
        "Payment is still pending. You can continue from your reservation while we wait for confirmation."
      );
      router.push(`/reservations/${String(result.reservation.id)}`);
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
      setCheckoutMessage("");
    } finally {
      setReserving(false);
    }
  };

  const remainingQuantity = listing ? getRemainingQuantity(listing) : 0;
  const maxReservableQuantity = Math.min(remainingQuantity, 2);
  const canReserve = Boolean(listing?.id && !listing.is_free && remainingQuantity > 0);

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
          <div className="space-y-4">
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
                <Info label="Meals saved" value={listingImpact?.total_meals_saved} />
                <Info label="CO2 saved" value={listingImpact?.estimated_co2_saved} />
              </div>

              <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <label
                    htmlFor="reservation-quantity"
                    className="text-xs font-medium uppercase text-zinc-500"
                  >
                    Reserve quantity
                  </label>
                  <input
                    id="reservation-quantity"
                    value={quantity}
                    inputMode="numeric"
                    min={1}
                    max={maxReservableQuantity}
                    disabled={!canReserve || reserving}
                    className="w-28 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                  <p className="text-xs text-zinc-500">
                    Maximum 2 items per reservation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={reserveAndPay}
                  disabled={!canReserve || reserving}
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reserving ? "Processing payment..." : "Reserve and Pay"}
                </button>
              </div>

              {listing.is_free && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  Free listings are reserved through NGO flows.
                </p>
              )}

              {!listing.is_free && remainingQuantity <= 0 && (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                  This listing is no longer available for reservation.
                </p>
              )}

              {checkoutMessage && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {checkoutMessage}
                </p>
              )}
            </section>

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Provider Reputation
              </h2>
              <ProviderReputation summary={providerRatings} />
            </div>

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">Reviews</h2>
              <ReviewList ratings={ratings} emptyMessage="No reviews for this listing yet." />
            </div>
          </div>
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
