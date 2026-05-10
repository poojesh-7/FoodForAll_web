"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReservationCard from "@/components/reservations/ReservationCard";
import { mergeRealtimeRows } from "@/lib/realtimeMerge";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { ReservationHistoryRow } from "@backend/contracts/api-contracts";

function isActiveReservation(reservation: ReservationHistoryRow) {
  if (reservation.status === "cancelled" || reservation.status === "picked_up") {
    return false;
  }
  if (reservation.task_status === "delivered") return false;
  return true;
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<ReservationHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reservationVersion = useRealtimeStore((state) => state.reservationVersion);
  const reservationsById = useRealtimeStore((state) => state.reservations);

  useEffect(() => {
    let active = true;

    reservationService
      .getMyReservations()
      .then((result) => {
        if (active) setReservations(result);
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
  }, []);

  useEffect(() => {
    if (!reservationVersion) return;
    queueMicrotask(() =>
      setReservations((current) =>
        mergeRealtimeRows<ReservationHistoryRow>(current, reservationsById)
      )
    );
  }, [reservationVersion, reservationsById]);

  const activeReservations = useMemo(
    () => reservations.filter(isActiveReservation),
    [reservations]
  );
  const historyReservations = useMemo(
    () => reservations.filter((reservation) => !isActiveReservation(reservation)),
    [reservations]
  );

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">
              Reservations
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Track active reservations, pickup codes, payment state, and history.
            </p>
          </div>
          <Link
            href="/food"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Browse Food
          </Link>
        </header>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading reservations...
          </div>
        ) : reservations.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No reservations found.
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Active Reservations
              </h2>
              {activeReservations.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
                  No active reservations.
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {activeReservations.map((reservation) => (
                    <ReservationCard
                      key={String(reservation.id)}
                      reservation={reservation}
                      href={`/reservations/${String(reservation.id)}`}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Reservation History
              </h2>
              {historyReservations.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
                  Completed and cancelled reservations will appear here.
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {historyReservations.map((reservation) => (
                    <ReservationCard
                      key={String(reservation.id)}
                      reservation={reservation}
                      href={`/reservations/${String(reservation.id)}`}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
