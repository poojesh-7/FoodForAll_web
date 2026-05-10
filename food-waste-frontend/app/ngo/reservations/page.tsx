"use client";

import { useEffect, useState } from "react";
import NGOReservationCard from "@/components/ngo/NGOReservationCard";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import RatingForm from "@/components/ratings/RatingForm";
import { mergeRealtimeRows } from "@/lib/realtimeMerge";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import {
  ngoService,
  type NGOReservationHistoryRow,
} from "@/services/ngo.service";
import { ratingService } from "@/services/rating.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import { useRouter } from "next/navigation";

function canReviewReservation(reservation: NGOReservationHistoryRow) {
  const completed =
    reservation.task_status === "delivered" || Boolean(reservation.completed_at);
  const paymentAllowsReview =
    reservation.payment_status === "paid" ||
    reservation.payment_status === "not_required";

  return (
    reservation.pickup_type === "ngo" &&
    completed &&
    paymentAllowsReview &&
    !reservation.review_id
  );
}

export default function NGOReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<NGOReservationHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reservationVersion = useRealtimeStore((state) => state.reservationVersion);
  const reservationsById = useRealtimeStore((state) => state.reservations);

  useEffect(() => {
    let active = true;

    ngoService
      .getReservations()
      .then((result) => {
        if (active) setReservations(result);
      })
      .catch((err) => {
        if (!active) return;
        const message = ngoService.getErrorMessage(err);
        if (isPendingVerificationError(message)) {
          router.push(pendingVerificationRoute);
          return;
        }
        setError(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!reservationVersion) return;
    queueMicrotask(() =>
      setReservations((current) =>
        mergeRealtimeRows<NGOReservationHistoryRow>(current, reservationsById)
      )
    );
  }, [reservationVersion, reservationsById]);

  const submitReview = async (
    reservation: NGOReservationHistoryRow,
    rating: number,
    review: string
  ) => {
    try {
      setError("");
      setSuccess("");
      const created = await ratingService.createRating({
        reservation_id: reservation.id,
        rating,
        review: review || null,
      });

      setReservations((current) =>
        current.map((item) =>
          String(item.id) === String(reservation.id)
            ? {
                ...item,
                review_id: created.id,
                review_rating: created.rating ?? rating,
                review_text: created.review ?? (review || null),
              }
            : item
        )
      );
      setSuccess("Review submitted successfully.");
    } catch (err) {
      setError(ratingService.getErrorMessage(err));
    }
  };

  return (
    <NGOShell
      title="Reservation History"
      description="Review NGO reservations, provider details, and pickup workflow codes."
    >
      {error && <NGOStateBlock title={error} tone="error" />}
      {success && <NGOStateBlock title={success} tone="success" />}

      {loading ? (
        <NGOStateBlock title="Loading reservations..." />
      ) : reservations.length === 0 ? (
        <NGOStateBlock
          title="No NGO reservations yet."
          description="Reservations created from nearby listings or accepted provider requests will appear here."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {reservations.map((reservation) => (
            <NGOReservationCard
              key={String(reservation.id)}
              reservation={reservation}
              actions={
                reservation.review_id ? (
                  <p className="text-sm text-emerald-700">
                    You have already reviewed this reservation.
                  </p>
                ) : canReviewReservation(reservation) ? (
                  <RatingForm
                    framed={false}
                    title="Review Provider"
                    description="Rate the provider after successful delivery."
                    onSubmit={(rating, review) =>
                      submitReview(reservation, rating, review)
                    }
                  />
                ) : null
              }
            />
          ))}
        </div>
      )}
    </NGOShell>
  );
}
