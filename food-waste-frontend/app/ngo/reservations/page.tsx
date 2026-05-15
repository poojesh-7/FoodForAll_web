"use client";

import { useEffect, useMemo, useState } from "react";
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

type ActiveReservationFilter =
  | "all"
  | "reserved"
  | "pending"
  | "volunteer_started"
  | "picked_from_provider";

function getReservationState(reservation: NGOReservationHistoryRow) {
  const status = String(reservation.status ?? "").toLowerCase();
  const taskStatus = String(reservation.task_status ?? "").toLowerCase();
  const paymentStatus = String(reservation.payment_status ?? "").toLowerCase();

  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "expired" ||
    paymentStatus === "expired" ||
    paymentStatus === "failed"
  ) {
    return "failed";
  }
  if (
    taskStatus === "delivered" ||
    status === "picked_up" ||
    Boolean(reservation.completed_at)
  ) {
    return "completed";
  }
  if (taskStatus === "picked_from_provider") return "picked_from_provider";
  if (taskStatus === "in_progress") return "volunteer_started";
  if (taskStatus === "pending") return "pending";
  return "reserved";
}

function getActiveFilterLabel(filter: ActiveReservationFilter) {
  const labels: Record<ActiveReservationFilter, string> = {
    all: "All Active",
    reserved: "Reserved",
    pending: "Pending",
    volunteer_started: "Volunteer Started",
    picked_from_provider: "Picked From Provider",
  };

  return labels[filter];
}

function ReservationMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
      <p className="mt-1 text-sm text-zinc-600">{detail}</p>
    </article>
  );
}

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
  const [activeFilter, setActiveFilter] =
    useState<ActiveReservationFilter>("all");
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

  const groupedReservations = useMemo(() => {
    const active = reservations.filter((reservation) => {
      const state = getReservationState(reservation);
      return state !== "completed" && state !== "failed";
    });
    const completed = reservations.filter(
      (reservation) => getReservationState(reservation) === "completed"
    );
    const failed = reservations.filter(
      (reservation) => getReservationState(reservation) === "failed"
    );
    const filteredActive =
      activeFilter === "all"
        ? active
        : active.filter(
            (reservation) => getReservationState(reservation) === activeFilter
          );

    return { active, filteredActive, completed, failed };
  }, [activeFilter, reservations]);

  const renderReviewAction = (reservation: NGOReservationHistoryRow) => {
    if (reservation.review_id) {
      return (
        <p className="text-sm font-medium text-emerald-700">
          You have already reviewed this reservation.
        </p>
      );
    }

    if (!canReviewReservation(reservation)) return null;

    return (
      <details className="rounded-md border border-zinc-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium text-zinc-950">
          Review provider
        </summary>
        <div className="mt-3">
          <RatingForm
            framed={false}
            title="Provider Rating"
            description="Rate the provider after successful delivery."
            onSubmit={(rating, review) =>
              submitReview(reservation, rating, review)
            }
          />
        </div>
      </details>
    );
  };

  const renderReservations = (items: NGOReservationHistoryRow[]) => (
    <div className="grid gap-4 xl:grid-cols-2">
      {items.map((reservation) => (
        <NGOReservationCard
          key={String(reservation.id)}
          reservation={reservation}
          actions={renderReviewAction(reservation)}
        />
      ))}
    </div>
  );

  return (
    <NGOShell
      title="NGO Reservations"
      description="Track active rescue work first, then review completed and archived reservations."
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
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-3">
            <ReservationMetric
              label="Active"
              value={groupedReservations.active.length}
              detail="Operational rescue work"
            />
            <ReservationMetric
              label="Completed"
              value={groupedReservations.completed.length}
              detail="Delivered or picked up"
            />
            <ReservationMetric
              label="Archived"
              value={groupedReservations.failed.length}
              detail="Failed, cancelled, or expired"
            />
          </section>

          <section className="space-y-3">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <h2 className="text-base font-semibold text-zinc-950">
                Active Reservations
              </h2>
              <select
                value={activeFilter}
                onChange={(event) =>
                  setActiveFilter(event.target.value as ActiveReservationFilter)
                }
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              >
                {(
                  [
                    "all",
                    "reserved",
                    "pending",
                    "volunteer_started",
                    "picked_from_provider",
                  ] as const
                ).map((filter) => (
                  <option key={filter} value={filter}>
                    {getActiveFilterLabel(filter)}
                  </option>
                ))}
              </select>
            </div>
            {groupedReservations.filteredActive.length === 0 ? (
              <NGOStateBlock title="No active reservations match this filter." />
            ) : (
              renderReservations(groupedReservations.filteredActive)
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-950">
              Completed Reservations
            </h2>
            {groupedReservations.completed.length === 0 ? (
              <NGOStateBlock title="No completed reservations yet." />
            ) : (
              renderReservations(groupedReservations.completed)
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-950">
              Failed or Cancelled
            </h2>
            {groupedReservations.failed.length === 0 ? (
              <NGOStateBlock title="No failed or cancelled reservations." />
            ) : (
              renderReservations(groupedReservations.failed)
            )}
          </section>
        </div>
      )}
    </NGOShell>
  );
}
