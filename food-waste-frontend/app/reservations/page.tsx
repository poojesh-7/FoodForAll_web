"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import ReservationCancelModal from "@/components/modals/ReservationCancelModal";
import ReservationCard from "@/components/reservations/ReservationCard";
import { openCashfreeCheckout } from "@/lib/cashfree";
import {
  getPaymentRemainingMs,
  getPaymentSessionByReservationId,
  getPaymentSessionFromReservation,
  getReservationPaymentState,
  savePaymentSession,
} from "@/lib/payment-flow";
import { mergeRealtimeRows } from "@/lib/realtimeMerge";
import { classifyReservationLifecycle } from "@/lib/reservationLifecycle";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { DbId, ReservationHistoryRow } from "@shared/contracts/api-contracts";

type ReservationBucket = "active" | "completed" | "archived";
type ReservationTab = ReservationBucket;

function getReservationBucket(reservation: ReservationHistoryRow): ReservationBucket {
  const lifecycle = classifyReservationLifecycle(reservation);
  if (lifecycle.status === "completed") return "completed";
  if (lifecycle.group === "history") return "archived";
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
  renderActions,
}: {
  tab: ReservationTab;
  reservations: ReservationHistoryRow[];
  renderActions: (reservation: ReservationHistoryRow) => ReactNode;
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
              actions={renderActions(reservation)}
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
  const [success, setSuccess] = useState("");
  const [paymentProcessingId, setPaymentProcessingId] = useState<DbId | null>(null);
  const [cancellingId, setCancellingId] = useState<DbId | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReservationHistoryRow | null>(null);
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

  const reloadReservations = async () => {
    const result = await reservationService.getMyReservations();
    setReservations(result);
    return result;
  };

  const resumePayment = async (reservation: ReservationHistoryRow) => {
    if (!reservation.id) return;

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
      setError("");
      setSuccess("Opening secure Cashfree checkout...");
      setPaymentProcessingId(reservation.id);
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
        checkoutResult?.error?.message || "Refreshing reservation payment state..."
      );
      await reloadReservations();
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
      setSuccess("");
    } finally {
      setPaymentProcessingId(null);
    }
  };

  const cancelReservation = async () => {
    if (!cancelTarget?.id || cancellingId) return;

    try {
      setError("");
      setSuccess("");
      setCancellingId(cancelTarget.id);
      await reservationService.cancelReservation(cancelTarget.id);
      await reloadReservations();
      setSuccess("Payment hold cancelled. Reserved stock has been released.");
      setCancelTarget(null);
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
    } finally {
      setCancellingId(null);
    }
  };

  const renderReservationActions = (reservation: ReservationHistoryRow) => {
    const paymentState = getReservationPaymentState(reservation);

    if (paymentState !== "payment_pending") {
      if (getReservationBucket(reservation) !== "completed" || !reservation.id) {
        return null;
      }

      return (
        <Link
          href={`/reservations/${String(reservation.id)}`}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950"
        >
          {reservation.review_id ? "Edit Review" : "Leave Review"}
        </Link>
      );
    }

    const session =
      getPaymentSessionFromReservation(reservation) ??
      getPaymentSessionByReservationId(reservation.id);
    const expired = getPaymentRemainingMs(reservation) === 0;

    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => resumePayment(reservation)}
          disabled={
            !session ||
            expired ||
            String(paymentProcessingId) === String(reservation.id)
          }
          className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {String(paymentProcessingId) === String(reservation.id)
            ? "Opening..."
            : "Resume Payment"}
        </button>
        <button
          type="button"
          onClick={() => setCancelTarget(reservation)}
          disabled={String(cancellingId) === String(reservation.id)}
          className="min-h-10 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
        >
          {String(cancellingId) === String(reservation.id)
            ? "Cancelling..."
            : "Cancel Hold"}
        </button>
      </div>
    );
  };

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
        {success && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
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
              renderActions={renderReservationActions}
            />
          </div>
        )}
        <ReservationCancelModal
          open={Boolean(cancelTarget)}
          onClose={() => {
            if (!cancellingId) setCancelTarget(null);
          }}
          onConfirm={cancelReservation}
          loading={Boolean(cancellingId)}
          reservationType="user"
          reservationId={cancelTarget?.id ?? null}
          paymentPending={getReservationPaymentState(cancelTarget ?? {}) === "payment_pending"}
        />
      </div>
    </main>
  );
}
