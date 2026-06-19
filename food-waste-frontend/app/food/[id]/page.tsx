"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clock3,
  CreditCard,
  Leaf,
  Minus,
  Package,
  Plus,
  ShieldCheck,
  Store,
  Utensils,
} from "lucide-react";
import ProviderReputation from "@/components/ratings/ProviderReputation";
import ReviewList from "@/components/ratings/ReviewList";
import PricingBreakdown from "@/components/payments/PricingBreakdown";
import FoodImage from "@/components/FoodImage";
import { openCashfreeCheckout } from "@/lib/cashfree";
import { foodService } from "@/services/food.service";
import { impactService } from "@/services/impact.service";
import { ratingService } from "@/services/rating.service";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import {
  formatFoodDate,
  formatQuantityWithUnit,
  getListingPrice,
  getRestaurantDisplayName,
} from "@/lib/food";
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
  ReservationPricingPreview,
} from "@shared/contracts/api-contracts";

const PAYMENT_POLL_ATTEMPTS = 8;
const PAYMENT_POLL_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getRemainingQuantity(listing: FoodListingRow) {
  const remaining = Number(listing.remaining_quantity ?? listing.quantity ?? 0);
  return Number.isFinite(remaining) ? remaining : 0;
}

function mergeListingState(
  current: FoodListingRow | null,
  update?: FoodListingRow | null
) {
  if (!current || !update || String(current.id) !== String(update.id)) {
    return current;
  }

  return { ...current, ...update };
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getProviderDisplayName(listing: FoodListingRow) {
  return getRestaurantDisplayName(listing);
}

function getStatusClasses(status?: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "expired" || status === "inactive") {
    return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function isPickupUrgent(value?: string | number | null) {
  if (!value) return false;
  const pickupEnd = new Date(value).getTime();
  return Number.isFinite(pickupEnd) && pickupEnd - Date.now() <= 60 * 60 * 1000;
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
  const [pricingPreview, setPricingPreview] =
    useState<ReservationPricingPreview | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const listingVersion = useRealtimeStore((state) => state.listingVersion);
  const listingsById = useRealtimeStore((state) => state.listings);

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
        const realtimeListing = result.id
          ? useRealtimeStore.getState().listings[String(result.id)]
          : null;
        setListing(realtimeListing ? { ...result, ...realtimeListing } : result);
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

  useEffect(() => {
    if (!listingVersion || !listing?.id) return;
    const realtimeListing = listingsById[String(listing.id)];
    if (!realtimeListing) return;

    queueMicrotask(() => {
      setListing((current) => mergeListingState(current, realtimeListing));
    });
  }, [listingVersion, listingsById, listing?.id]);

  const refreshListingSnapshot = async () => {
    if (!listing?.id) return;

    try {
      const latest = await foodService.getFoodById(listing.id);
      const realtimeListing = useRealtimeStore.getState().listings[String(listing.id)];
      setListing(realtimeListing ? { ...latest, ...realtimeListing } : latest);
    } catch {
      // The websocket snapshot remains the primary recovery path for transient refresh failures.
    }
  };

  const applyConfirmedLocalHold = (reservedQuantity: number, previousRemaining: number) => {
    setListing((current) => {
      if (!current || String(current.id) !== String(params.id)) return current;

      const currentRemaining = getRemainingQuantity(current);
      if (currentRemaining < previousRemaining) return current;

      const nextRemaining = Math.max(currentRemaining - reservedQuantity, 0);
      return {
        ...current,
        remaining_quantity: nextRemaining,
        status: nextRemaining > 0 ? current.status : "completed",
      };
    });
  };

  useEffect(() => {
    if (!listing?.id || listing.is_free) {
      queueMicrotask(() => {
        setPricingPreview(null);
        setPricingLoading(false);
      });
      return;
    }

    const quantityValue = Number(quantity);
    const maxQuantity = Math.min(getRemainingQuantity(listing), 2);

    if (
      !Number.isFinite(quantityValue) ||
      quantityValue <= 0 ||
      quantityValue > maxQuantity
    ) {
      queueMicrotask(() => {
        setPricingPreview(null);
        setPricingLoading(false);
      });
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setPricingLoading(true);
      reservationService
        .previewReservation({
          listing_id: listing.id as DbId,
          quantity: quantityValue,
        })
        .then((preview) => {
          if (active) {
            setPricingPreview(preview);
            setError("");
          }
        })
        .catch((err) => {
          if (active) {
            setPricingPreview(null);
            setError(reservationService.getErrorMessage(err));
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
  }, [listing, quantity]);

  const pollReservationPayment = async (reservationId: DbId) => {
    let latest: ReservationDetails | null = null;

    for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS; attempt += 1) {
      try {
        latest = await reservationService.getReservationById(reservationId);
      } catch {
        return null;
      }
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
    const remainingBeforeHold = getRemainingQuantity(listing);

    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      setError("Enter a valid quantity.");
      return;
    }

    if (quantityValue > maxQuantity) {
      setError(
        `You can reserve up to ${formatQuantityWithUnit(maxQuantity, listing)}.`
      );
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

      applyConfirmedLocalHold(quantityValue, remainingBeforeHold);

      savePaymentSession({
        orderId: result.payment.order_id,
        paymentSessionId: result.payment.payment_session_id,
        reservationId: result.reservation.id,
        listingId: listing.id,
      });

      const depositAmount = Number(
        result.payment.reliability_deposit_amount ?? result.policy?.depositAmount ?? 0
      );
      setCheckoutMessage(
        depositAmount > 0
          ? `Rs. ${depositAmount.toFixed(2)} refundable reliability deposit added. Deposit will be refunded automatically after successful pickup completion.`
          : "Opening secure Cashfree checkout..."
      );
      const checkoutResult = await openCashfreeCheckout({
        paymentSessionId: result.payment.payment_session_id,
      });

      if (!checkoutResult || checkoutResult.error?.message) {
        await reservationService
          .cancelReservation(result.reservation.id)
          .catch(() => undefined);
        await refreshListingSnapshot();
        setCheckoutMessage("");
        setError("Payment was not completed. Reservation was not created.");
        return;
      }

      setCheckoutMessage("Verifying payment status...");
      const verifiedReservation = await pollReservationPayment(result.reservation.id);
      const paymentState = verifiedReservation
        ? getReservationPaymentState(verifiedReservation)
        : "failed";

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
        await refreshListingSnapshot();
        setCheckoutMessage("");
        setError("Payment was not completed. Reservation was not created.");
        return;
      }

      setCheckoutMessage("");
      setError("Payment was not completed. Reservation was not created.");
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
  const providerName = listing ? getProviderDisplayName(listing) : "-";
  const pickupUrgent = listing ? isPickupUrgent(listing.pickup_end_time) : false;
  const quantityValue = Number(quantity);
  const fallbackFoodAmount =
    listing && Number.isFinite(quantityValue)
      ? Number(listing.price || 0) * Math.max(quantityValue, 0)
      : 0;
  const foodAmount = pricingPreview?.foodAmount ?? fallbackFoodAmount;
  const depositAmount = pricingPreview?.depositAmount ?? 0;
  const totalAmount = pricingPreview?.totalAmount ?? foodAmount + depositAmount;

  const setQuantityWithinLimit = (nextValue: number) => {
    const bounded = Math.max(1, Math.min(maxReservableQuantity || 1, nextValue));
    setQuantity(String(bounded));
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link
          href="/food"
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
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
          <div className="space-y-5">
            <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <FoodImage source={listing} className="h-72" />
              <div className="space-y-5 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                          listing.status
                        )}`}
                      >
                        {String(listing.status ?? "active").replace(/_/g, " ")}
                      </span>
                      {pickupUrgent && (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                          Pickup soon
                        </span>
                      )}
                    </div>
                    <h1 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950">
                      {String(listing.title ?? "Untitled food")}
                    </h1>
                    {listing.description && (
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
                        {String(listing.description)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-950 px-3 py-2 text-base font-semibold text-white">
                    {getListingPrice(listing)}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <DetailPill
                    icon={<Package className="h-4 w-4" aria-hidden="true" />}
                    label="Available"
                    value={`${formatQuantityWithUnit(
                      remainingQuantity,
                      listing
                    )} of ${formatQuantityWithUnit(listing.quantity, listing)}`}
                  />
                  <DetailPill
                    icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
                    label="Pickup Window"
                    value={
                      <>
                        <span>{formatFoodDate(listing.pickup_start_time)}</span>
                        <span className="mt-1 block text-xs font-medium text-zinc-500">
                          Ends {formatFoodDate(listing.pickup_end_time)}
                        </span>
                      </>
                    }
                    emphasis={pickupUrgent}
                  />
                  <DetailPill
                    icon={<Store className="h-4 w-4" aria-hidden="true" />}
                    label="Restaurant"
                    value={providerName}
                  />
                  <DetailPill
                    icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                    label="Pickup Type"
                    value="Self pickup"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <ImpactPill
                    icon={<Utensils className="h-4 w-4" aria-hidden="true" />}
                    label="Meals saved"
                    value={displayValue(listingImpact?.total_meals_saved)}
                  />
                  <ImpactPill
                    icon={<Leaf className="h-4 w-4" aria-hidden="true" />}
                    label="CO2 saved"
                    value={displayValue(listingImpact?.estimated_co2_saved)}
                  />
                </div>
              </div>

              <div className="border-t border-zinc-100 bg-zinc-50 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-2">
                    <label
                      htmlFor="reservation-quantity"
                      className="text-xs font-medium uppercase text-zinc-500"
                    >
                      Reserve quantity
                    </label>
                    <div className="flex w-fit overflow-hidden rounded-md border border-zinc-300 bg-white">
                      <button
                        type="button"
                        onClick={() => setQuantityWithinLimit(quantityValue - 1)}
                        disabled={!canReserve || reserving || quantityValue <= 1}
                        className="flex h-11 w-11 items-center justify-center border-r border-zinc-200 text-zinc-700 disabled:opacity-40"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <input
                        id="reservation-quantity"
                        value={quantity}
                        inputMode="numeric"
                        min={1}
                        max={maxReservableQuantity}
                        disabled={!canReserve || reserving}
                        className="h-11 w-16 bg-white text-center text-sm font-semibold text-zinc-950 outline-none disabled:bg-zinc-100"
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setQuantityWithinLimit(quantityValue + 1)}
                        disabled={
                          !canReserve ||
                          reserving ||
                          quantityValue >= maxReservableQuantity
                        }
                        className="flex h-11 w-11 items-center justify-center border-l border-zinc-200 text-zinc-700 disabled:opacity-40"
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Reserve up to{" "}
                      {formatQuantityWithUnit(maxReservableQuantity || 0, listing)} from
                      this listing.
                    </p>
                  </div>

                  <div className="w-full max-w-md space-y-3 lg:w-[28rem]">
                    {canReserve && (
                      <PricingBreakdown
                        role="user"
                        foodAmount={foodAmount}
                        depositAmount={depositAmount}
                        totalAmount={totalAmount}
                        requiresDeposit={pricingPreview?.requiresDeposit}
                        reservationCapacity={pricingPreview?.reservationCapacity}
                        loading={pricingLoading}
                      />
                    )}
                    <button
                      type="button"
                      onClick={reserveAndPay}
                      disabled={!canReserve || reserving || pricingLoading}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      {reserving
                        ? "Processing payment..."
                        : `Reserve & Pay Rs. ${totalAmount.toFixed(2)}`}
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {listing.is_free && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      Free listings are reserved through NGO flows.
                    </p>
                  )}

                  {!listing.is_free && remainingQuantity <= 0 && (
                    <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600">
                      This listing is no longer available for reservation.
                    </p>
                  )}

                  {checkoutMessage && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {checkoutMessage}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  Restaurant Reputation
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Recent pickup feedback for {providerName}.
                </p>
              </div>
              <ProviderReputation summary={providerRatings} />
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Reviews</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  What other food savers said after pickup.
                </p>
              </div>
              <ReviewList ratings={ratings} emptyMessage="No reviews for this listing yet." />
            </section>
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

function DetailPill({
  icon,
  label,
  value,
  emphasis = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        emphasis ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function ImpactPill({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-emerald-700">
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium uppercase text-emerald-700">{label}</p>
        <p className="mt-1 text-lg font-semibold text-zinc-950">{value}</p>
      </div>
    </div>
  );
}
