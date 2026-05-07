"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReservationCard from "@/components/reservations/ReservationCard";
import ReservationTimeline from "@/components/reservations/ReservationTimeline";
import { reservationService } from "@/services/reservation.service";
import type { ReservationDetails } from "@backend/contracts/api-contracts";
import { useParams } from "next/navigation";

function canCancel(reservation: ReservationDetails) {
  return reservation.status === "reserved" && reservation.task_status === "pending";
}

export default function ReservationDetailPage() {
  const params = useParams<{ id: string }>();
  const [reservation, setReservation] = useState<ReservationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    reservationService
      .getReservationById(params.id)
      .then((result) => {
        if (active) setReservation(result);
      })
      .catch((err) => {
        if (active) setError(reservationService.getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

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
