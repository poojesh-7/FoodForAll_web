"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RatingForm from "@/components/ratings/RatingForm";
import ReviewList from "@/components/ratings/ReviewList";
import ReservationCard from "@/components/reservations/ReservationCard";
import ReservationTimeline from "@/components/reservations/ReservationTimeline";
import { ratingService } from "@/services/rating.service";
import { reservationService } from "@/services/reservation.service";
import type {
  ListingRating,
  ReservationDetails,
} from "@backend/contracts/api-contracts";
import { useParams } from "next/navigation";

function canCancel(reservation: ReservationDetails) {
  return reservation.status === "reserved" && reservation.task_status === "pending";
}

function canRate(reservation: ReservationDetails) {
  return (
    reservation.status === "picked_up" &&
    reservation.pickup_type === "self_pickup" &&
    Boolean(reservation.listing_id)
  );
}

function isRatingWindowExpired(reservation: ReservationDetails) {
  if (!reservation.completed_at) return false;
  const completedAt = new Date(reservation.completed_at).getTime();
  if (Number.isNaN(completedAt)) return false;
  return Date.now() - completedAt > 48 * 60 * 60 * 1000;
}

export default function ReservationDetailPage() {
  const params = useParams<{ id: string }>();
  const [reservation, setReservation] = useState<ReservationDetails | null>(null);
  const [ratings, setRatings] = useState<ListingRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    async function loadReservation() {
      try {
        setLoading(true);
        setError("");
        const result = await reservationService.getReservationById(params.id);
        const listingRatings = result.listing_id
          ? await ratingService.getListingRatings(result.listing_id)
          : [];

        if (!active) return;
        setReservation(result);
        setRatings(listingRatings);
      } catch (err) {
        if (active) setError(reservationService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadReservation();

    return () => {
      active = false;
    };
  }, [params.id]);

  const cancelReservation = async () => {
    if (!reservation?.id) return;
    if (!confirm("Cancel this reservation?")) return;

    try {
      setCancelling(true);
      setError("");
      setSuccess("");
      await reservationService.cancelReservation(reservation.id);
      setReservation({
        ...reservation,
        status: "cancelled",
      });
      setSuccess("Reservation cancelled successfully.");
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  const submitRating = async (rating: number, review: string) => {
    if (!reservation?.listing_id) return;

    try {
      setError("");
      setSuccess("");
      const created = await ratingService.createRating({
        listing_id: reservation.listing_id,
        rating,
        review: review || null,
      });
      setRatingSubmitted(true);
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
            <ReservationTimeline reservation={reservation} />
            <ReservationCard
              reservation={reservation}
              actions={
                canCancel(reservation) ? (
                  <button
                    onClick={cancelReservation}
                    disabled={cancelling}
                    className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                  >
                    {cancelling ? "Cancelling..." : "Cancel Reservation"}
                  </button>
                ) : (
                  <p className="text-sm text-zinc-600">
                    Cancellation is unavailable after the window closes, after volunteer pickup starts, or once completed.
                  </p>
                )
              }
            />
            {canRate(reservation) && !ratingSubmitted && !isRatingWindowExpired(reservation) && (
              <RatingForm onSubmit={submitRating} />
            )}
            {canRate(reservation) && isRatingWindowExpired(reservation) && (
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
