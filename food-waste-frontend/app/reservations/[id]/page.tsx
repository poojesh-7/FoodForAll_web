"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import RatingForm from "@/components/ratings/RatingForm";
import ReviewList from "@/components/ratings/ReviewList";
import ReservationCancelModal from "@/components/modals/ReservationCancelModal";
import ProviderReportForm from "@/components/reservations/ProviderReportForm";
import ReservationCard from "@/components/reservations/ReservationCard";
import ReservationTimeline from "@/components/reservations/ReservationTimeline";
import { openCashfreeCheckout } from "@/lib/cashfree";
import {
  getPaymentSessionByReservationId,
  getPaymentSessionFromReservation,
  getPaymentRemainingMs,
  getReservationPaymentState,
  isRetryablePaymentState,
  savePaymentSession,
} from "@/lib/payment-flow";
import { ratingService } from "@/services/rating.service";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  ListingRating,
  ReservationDetails,
} from "@backend/contracts/api-contracts";
import { useParams, useRouter } from "next/navigation";

function canCancel(reservation: ReservationDetails) {
  if (
    reservation.status === "payment_pending" &&
    reservation.payment_status === "pending"
  ) {
    return true;
  }

  if (reservation.pickup_type === "ngo") {
    return reservation.status === "reserved" && reservation.task_status === "pending";
  }

  return (
    (reservation.status === "reserved" || reservation.status === "payment_pending") &&
    reservation.pickup_type === "self_pickup" &&
    isBeforeCancellationCutoff(reservation)
  );
}

function isBeforeCancellationCutoff(reservation: ReservationDetails) {
  if (!reservation.pickup_end_time) return false;

  const pickupEnd = new Date(reservation.pickup_end_time).getTime();
  if (Number.isNaN(pickupEnd)) return false;

  return Date.now() <= pickupEnd - 20 * 60 * 1000;
}

function getCancellationMessage(reservation: ReservationDetails) {
  if (reservation.pickup_type === "ngo") {
    return "NGO cancellation is available until a volunteer starts pickup.";
  }

  if (reservation.status === "cancelled") {
    if (reservation.payment_status === "refund_pending") {
      return "Refund is being processed asynchronously.";
    }

    if (reservation.payment_status === "refunded") {
      return "Refund completed.";
    }

    if (reservation.payment_status === "refund_failed") {
      return "Refund failed. Please contact support.";
    }

    return "Reservation has been cancelled.";
  }

  if (
    reservation.pickup_type === "self_pickup" &&
    reservation.status === "reserved" &&
    !isBeforeCancellationCutoff(reservation)
  ) {
    return "Cancellation is closed. This reservation is non-refundable and must still be collected.";
  }

  return "Cancellation is unavailable after pickup, expiry, or once a refund is already final.";
}

function canRate(reservation: ReservationDetails) {
  const isCompleted =
    reservation.pickup_type === "self_pickup"
      ? reservation.status === "picked_up" || Boolean(reservation.completed_at)
      : reservation.pickup_type === "ngo" &&
        (reservation.task_status === "delivered" || Boolean(reservation.completed_at));
  const paymentAllowsReview =
    reservation.payment_status === "paid" ||
    reservation.payment_status === "not_required";

  return (
    isCompleted &&
    paymentAllowsReview &&
    Boolean(reservation.listing_id)
  );
}

function isRatingWindowExpired(reservation: ReservationDetails) {
  if (!reservation.completed_at) return false;
  const completedAt = new Date(reservation.completed_at).getTime();
  if (Number.isNaN(completedAt)) return false;
  return Date.now() - completedAt > 48 * 60 * 60 * 1000;
}

async function fetchReservationData(id: string) {
  const result = await reservationService.getReservationById(id);
  const listingRatings = result.listing_id
    ? await ratingService.getListingRatings(result.listing_id)
    : [];

  return { result, listingRatings };
}

export default function ReservationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [reservation, setReservation] = useState<ReservationDetails | null>(null);
  const [ratings, setRatings] = useState<ListingRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reservationVersion = useRealtimeStore((state) => state.reservationVersion);
  const reservationsById = useRealtimeStore((state) => state.reservations);

  useEffect(() => {
    let active = true;

    async function loadInitialReservation() {
      try {
        setLoading(true);
        setError("");
        const { result, listingRatings } = await fetchReservationData(params.id);
        if (!active) return;
        setReservation(result);
        setRatings(listingRatings);
        setRatingSubmitted(Boolean(result.review_id));

        if (getReservationPaymentState(result) === "payment_pending") {
          setSuccess("Payment is pending. Continue checkout or wait for confirmation.");
        }
      } catch (err) {
        if (active) setError(reservationService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadInitialReservation();

    return () => {
      active = false;
    };
  }, [params.id]);

  useEffect(() => {
    if (!reservationVersion) return;
    const update = reservationsById[String(params.id)];
    if (!update) return;
    let active = true;

    queueMicrotask(() => {
      setReservation((current) =>
        current ? { ...current, ...update } : (update as ReservationDetails)
      );
    });

    fetchReservationData(params.id)
      .then(({ result, listingRatings }) => {
        if (!active) return;
        setReservation({ ...result, ...update });
        setRatings(listingRatings);
        setRatingSubmitted(Boolean(result.review_id));
      })
      .catch((err) => {
        if (active) setError(reservationService.getErrorMessage(err));
      });

    return () => {
      active = false;
    };
  }, [params.id, reservationVersion, reservationsById]);

  const loadReservation = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError("");
      const { result, listingRatings } = await fetchReservationData(params.id);
      setReservation(result);
      setRatings(listingRatings);
      setRatingSubmitted(Boolean(result.review_id));
      return result;
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const cancelReservation = async () => {
    if (!reservation?.id) return;
    if (cancelling) return;

    try {
      setCancelling(true);
      setError("");
      setSuccess("");
      const paymentPending =
        getReservationPaymentState(reservation) === "payment_pending";
      await reservationService.cancelReservation(reservation.id);
      if (paymentPending) {
        setCancelModalOpen(false);
        router.push("/reservations");
        return;
      }
      const latest = await loadReservation(false);
      setSuccess(
        latest?.payment_status === "refund_pending"
          ? "Reservation cancelled. Refund is being processed."
          : "Reservation cancelled successfully."
      );
      setCancelModalOpen(false);
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  const submitRating = async (rating: number, review: string) => {
    if (!reservation?.id || !reservation.listing_id) return;

    try {
      setError("");
      setSuccess("");
      const created = await ratingService.createRating({
        reservation_id: reservation.id,
        rating,
        review: review || null,
      });
      setRatingSubmitted(true);
      setReservation((current) =>
        current
          ? {
              ...current,
              review_id: created.id,
              review_rating: created.rating ?? rating,
              review_text: created.review ?? (review || null),
            }
          : current
      );
      setSuccess("Rating submitted successfully.");
      setRatings((current) => [
        {
          rating: created.rating ?? rating,
          review: created.review ?? (review || null),
          created_at: new Date().toISOString(),
          name: "You",
        },
        ...current,
      ]);
    } catch (err) {
      setError(ratingService.getErrorMessage(err));
    }
  };

  const continuePayment = async () => {
    if (!reservation?.id) return;

    const session =
      getPaymentSessionFromReservation(reservation) ??
      getPaymentSessionByReservationId(reservation.id);
    if (!session) {
      setError("Payment session is unavailable. Cancel this hold or wait for it to expire, then reserve again.");
      return;
    }

    if (getPaymentRemainingMs(reservation) === 0) {
      setError("This payment hold has expired. Refresh after cleanup or cancel it to restore stock now.");
      return;
    }

    try {
      setPaymentProcessing(true);
      setError("");
      setSuccess("Opening secure Cashfree checkout...");
      savePaymentSession({
        orderId: session.orderId,
        paymentSessionId: session.paymentSessionId,
        reservationId: session.reservationId,
        listingId: session.listingId,
      });
      const checkoutResult = await openCashfreeCheckout({
        paymentSessionId: session.paymentSessionId,
      });

      setSuccess(
        checkoutResult?.error?.message || "Verifying payment status from the backend..."
      );

      const latest = await loadReservation(false);
      const state = latest ? getReservationPaymentState(latest) : "payment_pending";

      if (state === "paid") {
        const params = new URLSearchParams({
          order_id: session.orderId,
          reservation_id: String(reservation.id),
        });
        router.push(`/payment-success?${params.toString()}`);
        return;
      }

      if (state === "failed" || state === "expired") {
        const params = new URLSearchParams({
          order_id: session.orderId,
          reservation_id: String(reservation.id),
        });
        router.push(`/payment-failed?${params.toString()}`);
        return;
      }

      setSuccess("Payment is still pending. We will keep showing the backend state here.");
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
      setSuccess("");
    } finally {
      setPaymentProcessing(false);
    }
  };

  const paymentState = reservation
    ? getReservationPaymentState(reservation)
    : "unknown";
  const canRetryPayment =
    reservation?.id && isRetryablePaymentState(paymentState);
  const cancellationMessage = reservation
    ? getCancellationMessage(reservation)
    : "";

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">
              Reservation Detail
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Review status, pickup codes, payment state, and cancellation eligibility.
            </p>
          </div>
          <Link
            href="/reservations"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Back
          </Link>
        </header>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading reservation...
          </div>
        ) : reservation ? (
          <>
            <section className="flex flex-col justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Payment state
                </p>
                <div className="mt-2">
                  <PaymentStatusBadge state={paymentState} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => loadReservation(false)}
                  disabled={paymentProcessing}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                >
                  Refresh
                </button>
                {canRetryPayment && (
                  <button
                    type="button"
                    onClick={continuePayment}
                    disabled={paymentProcessing}
                    className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {paymentProcessing ? "Processing..." : "Continue Payment"}
                  </button>
                )}
              </div>
            </section>
            <ReservationTimeline reservation={reservation} />
            <ReservationCard
              reservation={reservation}
              actions={
                canCancel(reservation) ? (
                  <button
                    onClick={() => setCancelModalOpen(true)}
                    disabled={cancelling}
                    className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                  >
                    {cancelling
                      ? "Cancelling..."
                      : paymentState === "payment_pending"
                        ? "Cancel Hold"
                        : "Cancel Reservation"}
                  </button>
                ) : (
                  <p className="text-sm text-zinc-600">
                    {cancellationMessage}
                  </p>
                )
              }
            />
            {canRate(reservation) && !ratingSubmitted && !isRatingWindowExpired(reservation) && (
              <RatingForm
                onSubmit={submitRating}
                title="Review Provider"
                description="Rate the provider for this completed pickup."
              />
            )}
            {canRate(reservation) && ratingSubmitted && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-700 shadow-sm">
                You have already reviewed this reservation.
              </div>
            )}
            {canRate(reservation) && !ratingSubmitted && isRatingWindowExpired(reservation) && (
              <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
                Rating window expired for this pickup.
              </div>
            )}
            {reservation.listing_id && (
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Listing Reviews
                </h2>
                <ReviewList ratings={ratings} />
              </section>
            )}
            {paymentState !== "payment_pending" &&
              reservation.id &&
              reservation.provider_id && (
              <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">
                    Report Provider
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Flag unsafe, fake, unavailable, or abusive pickup experiences.
                  </p>
                </div>
                <ProviderReportForm
                  reservationId={reservation.id}
                  onError={setError}
                  onSuccess={setSuccess}
                />
              </section>
            )}
            <ReservationCancelModal
              open={cancelModalOpen}
              onClose={() => {
                if (!cancelling) setCancelModalOpen(false);
              }}
              onConfirm={cancelReservation}
              loading={cancelling}
              reservationType={
                reservation.pickup_type === "ngo" ? "ngo" : "user"
              }
              reservationId={reservation.id}
              paymentPending={paymentState === "payment_pending"}
            />
          </>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Reservation not found.
          </div>
        )}
      </div>
    </main>
  );
}
