"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReservationCard from "@/components/reservations/ReservationCard";
import { mergeRealtimeRows } from "@/lib/realtimeMerge";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { ReservationHistoryRow } from "@backend/contracts/api-contracts";

type ReservationBucket = "active" | "completed" | "archived";
type ReservationTab = ReservationBucket;

function getReservationBucket(reservation: ReservationHistoryRow): ReservationBucket {
  const status = String(reservation.status ?? "").toLowerCase();
  const taskStatus = String(reservation.task_status ?? "").toLowerCase();
  const paymentStatus = String(reservation.payment_status ?? "").toLowerCase();

  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "expired" ||
    paymentStatus === "failed" ||
    paymentStatus === "expired"
  ) {
    return "archived";
  }

  if (
    status === "picked_up" ||
    status === "delivered" ||
    taskStatus === "delivered" ||
    Boolean(reservation.completed_at)
  ) {
    return "completed";
  }

  return "active";
}

const tabMeta: Record<
  ReservationTab,
  { label: string; title: string; description: string; emptyText: string }
> = {
  active: {
    label: "Active",
    title: "Active Reservations",
    description: "Reserved, pending, self-pickup, and pickup-in-progress orders.",
    emptyText: "No active reservations need action.",
  },
  completed: {
    label: "Completed",
    title: "Completed Reservations",
    description: "Picked up or delivered reservations.",
    emptyText: "Completed pickups will appear here.",
  },
  archived: {
    label: "Failed/Cancelled",
    title: "Failed, Cancelled, and Expired",
    description: "Inactive records kept out of the active pickup flow.",
    emptyText: "No failed, cancelled, or expired reservations.",
  },
};

function ReservationPanel({
  tab,
  reservations,
}: {
  tab: ReservationTab;
  reservations: ReservationHistoryRow[];
}) {
  const meta = tabMeta[tab];

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">{meta.title}</h2>
          <p className="text-sm text-zinc-600">{meta.description}</p>
        </div>
        <span className="text-sm font-medium text-zinc-500">
          {reservations.length} total
        </span>
      </div>
      {reservations.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
          {meta.emptyText}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {reservations.map((reservation) => (
            <ReservationCard
              key={String(reservation.id)}
              reservation={reservation}
              href={`/reservations/${String(reservation.id)}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<ReservationHistoryRow[]>([]);
  const [selectedTab, setSelectedTab] = useState<ReservationTab>("active");
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
    let active = true;

    queueMicrotask(() => {
      setReservations((current) =>
        mergeRealtimeRows<ReservationHistoryRow>(current, reservationsById)
      );
    });

    reservationService
      .getMyReservations()
      .then((result) => {
        if (!active) return;
        setReservations(
          mergeRealtimeRows<ReservationHistoryRow>(result, reservationsById)
        );
      })
      .catch((err) => {
        if (active) setError(reservationService.getErrorMessage(err));
      });

    return () => {
      active = false;
    };
  }, [reservationVersion, reservationsById]);

  const activeReservations = useMemo(
    () =>
      reservations.filter(
        (reservation) => getReservationBucket(reservation) === "active"
      ),
    [reservations]
  );
  const completedReservations = useMemo(
    () =>
      reservations.filter(
        (reservation) => getReservationBucket(reservation) === "completed"
      ),
    [reservations]
  );
  const archivedReservations = useMemo(
    () =>
      reservations.filter(
        (reservation) => getReservationBucket(reservation) === "archived"
      ),
    [reservations]
  );
  const reservationsByTab: Record<ReservationTab, ReservationHistoryRow[]> = {
    active: activeReservations,
    completed: completedReservations,
    archived: archivedReservations,
  };
  const selectedReservations = reservationsByTab[selectedTab];

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">
              Reservations
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Actionable pickups stay first, with completed and inactive records separated.
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
          <div className="space-y-4">
            <section className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
              <div className="grid gap-2 sm:grid-cols-3">
                {(["active", "completed", "archived"] as const).map((tab) => {
                  const selected = selectedTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSelectedTab(tab)}
                      className={`min-h-11 rounded-md px-3 text-sm font-semibold transition ${
                        selected
                          ? "bg-zinc-950 text-white shadow-sm"
                          : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                      }`}
                    >
                      {tabMeta[tab].label} ({reservationsByTab[tab].length})
                    </button>
                  );
                })}
              </div>
            </section>

            <ReservationPanel
              tab={selectedTab}
              reservations={selectedReservations}
            />
          </div>
        )}
      </div>
    </main>
  );
}
