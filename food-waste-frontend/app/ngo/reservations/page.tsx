"use client";

import { useEffect, useMemo, useState } from "react";
import ReservationCancelModal from "@/components/modals/ReservationCancelModal";
import NGOReservationCard from "@/components/ngo/NGOReservationCard";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import RatingForm from "@/components/ratings/RatingForm";
import ProviderReportForm from "@/components/reservations/ProviderReportForm";
import { openCashfreeCheckout } from "@/lib/cashfree";
import { mergeRealtimeRows } from "@/lib/realtimeMerge";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import {
  getPaymentRemainingMs,
  getPaymentSessionByReservationId,
  getPaymentSessionFromReservation,
  getReservationPaymentState,
  savePaymentSession,
} from "@/lib/payment-flow";
import {
  ngoService,
  type NGOReservationHistoryRow,
} from "@/services/ngo.service";
import { ratingService } from "@/services/rating.service";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { DbId } from "@backend/contracts/api-contracts";
import { useRouter } from "next/navigation";

type ActiveReservationFilter =
  | "all"
  | "payment_pending"
  | "reserved"
  | "pending"
  | "volunteer_started"
  | "picked_from_provider";
type ReservationTab = "active" | "completed" | "failed";

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
  if (status === "payment_pending" || paymentStatus === "pending") {
    return "payment_pending";
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
    payment_pending: "Payment Pending",
    reserved: "Reserved",
    pending: "Pending",
    volunteer_started: "Volunteer Started",
    picked_from_provider: "Picked From Provider",
  };

  return labels[filter];
}

const tabLabels: Record<ReservationTab, string> = {
  active: "Active",
  completed: "Completed",
  failed: "Failed/Cancelled",
};

const tabDescriptions: Record<ReservationTab, string> = {
  active: "Operational rescue work that may need volunteer follow-up.",
  completed: "Delivered or completed rescues with provider and volunteer context.",
  failed: "Failed, cancelled, or expired reservation records.",
};

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

function canCancelReservation(reservation: NGOReservationHistoryRow) {
  const status = String(reservation.status ?? "").toLowerCase();
  const taskStatus = String(reservation.task_status ?? "").toLowerCase();
  const paymentStatus = String(reservation.payment_status ?? "").toLowerCase();

  if (status === "payment_pending" && paymentStatus === "pending") {
    return true;
  }

  return (
    status === "reserved" &&
    taskStatus === "pending" &&
    !["refund_pending", "refunded", "refund_failed"].includes(paymentStatus) &&
    !reservation.completed_at
  );
}

export default function NGOReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<NGOReservationHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<ReservationTab>("active");
  const [activeFilter, setActiveFilter] =
    useState<ActiveReservationFilter>("all");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cancellingId, setCancellingId] = useState<DbId | null>(null);
  const [paymentProcessingId, setPaymentProcessingId] = useState<DbId | null>(null);
  const [cancelTarget, setCancelTarget] =
    useState<NGOReservationHistoryRow | null>(null);
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

  const reloadReservations = async () => {
    const result = await ngoService.getReservations();
    setReservations(result);
    return result;
  };

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

  const cancelReservation = async () => {
    if (!cancelTarget?.id) return;
    if (cancellingId) return;

    try {
      setError("");
      setSuccess("");
      setCancellingId(cancelTarget.id);
      const paymentPending =
        getReservationPaymentState(cancelTarget) === "payment_pending";
      await reservationService.cancelReservation(cancelTarget.id);
      await reloadReservations();
      setSuccess(
        paymentPending
          ? "Payment hold cancelled. Reserved stock has been released."
          : "Reservation cancelled successfully."
      );
      setCancelTarget(null);
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
    } finally {
      setCancellingId(null);
    }
  };

  const resumePayment = async (reservation: NGOReservationHistoryRow) => {
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
      setError(ngoService.getErrorMessage(err));
      setSuccess("");
    } finally {
      setPaymentProcessingId(null);
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
    const paymentState = getReservationPaymentState(reservation);
    const paymentPending = paymentState === "payment_pending";
    const paymentSession =
      getPaymentSessionFromReservation(reservation) ??
      getPaymentSessionByReservationId(reservation.id);
    const paymentExpired = getPaymentRemainingMs(reservation) === 0;

    return (
      <div className="space-y-2">
        {paymentPending && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => resumePayment(reservation)}
                disabled={
                  !paymentSession ||
                  paymentExpired ||
                  String(paymentProcessingId) === String(reservation.id)
                }
                className="min-h-10 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {String(paymentProcessingId) === String(reservation.id)
                  ? "Opening..."
                  : "Resume Payment"}
              </button>
              <button
                type="button"
                onClick={() => setCancelTarget(reservation)}
                disabled={
                  String(cancellingId) === String(reservation.id) ||
                  String(paymentProcessingId) === String(reservation.id)
                }
                className="min-h-10 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {String(cancellingId) === String(reservation.id)
                  ? "Cancelling..."
                  : "Cancel Hold"}
              </button>
            </div>
            {!paymentSession && (
              <p className="text-xs font-medium text-amber-800">
                Payment session details are unavailable. Cancel this hold or
                wait for automatic expiry before reserving again.
              </p>
            )}
            {paymentExpired && (
              <p className="text-xs font-medium text-amber-800">
                This hold has expired and will be released by cleanup shortly.
                You can cancel it now to restore stock immediately.
              </p>
            )}
          </>
        )}
        {!paymentPending && canCancelReservation(reservation) && (
          <button
            type="button"
            onClick={() => setCancelTarget(reservation)}
            disabled={String(cancellingId) === String(reservation.id)}
            className="min-h-10 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
          >
            {String(cancellingId) === String(reservation.id)
              ? "Cancelling..."
              : "Cancel Reservation"}
          </button>
        )}
        {!paymentPending && reservation.review_id ? (
          <p className="text-sm font-medium text-emerald-700">
            You have already reviewed this reservation.
          </p>
        ) : !paymentPending && canReviewReservation(reservation) ? (
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
        ) : null}
        {!paymentPending && (
          <details className="rounded-md border border-red-100 bg-white p-3">
            <summary className="cursor-pointer text-sm font-medium text-red-700">
              Report provider
            </summary>
            <div className="mt-3">
              <ProviderReportForm
                reservationId={reservation.id}
                onError={setError}
                onSuccess={setSuccess}
              />
            </div>
          </details>
        )}
      </div>
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

  const selectedReservations =
    selectedTab === "active"
      ? groupedReservations.filteredActive
      : groupedReservations[selectedTab];
  const selectedEmptyTitle =
    selectedTab === "active"
      ? "No active reservations match this filter."
      : selectedTab === "completed"
        ? "No completed reservations yet."
        : "No failed or cancelled reservations.";

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

          <section className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              {(["active", "completed", "failed"] as const).map((tab) => {
                const selected = selectedTab === tab;
                const count =
                  tab === "active"
                    ? groupedReservations.active.length
                    : groupedReservations[tab].length;

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
                    {tabLabels[tab]} ({count})
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">
                  {tabLabels[selectedTab]} Reservations
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {tabDescriptions[selectedTab]}
                </p>
              </div>
              {selectedTab === "active" && (
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
                      "payment_pending",
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
              )}
            </div>
            {selectedReservations.length === 0 ? (
              <NGOStateBlock title={selectedEmptyTitle} />
            ) : (
              renderReservations(selectedReservations)
            )}
          </section>
        </div>
      )}
      <ReservationCancelModal
        open={Boolean(cancelTarget)}
        onClose={() => {
          if (!cancellingId) setCancelTarget(null);
        }}
        onConfirm={cancelReservation}
        loading={Boolean(cancellingId)}
        reservationType="ngo"
        reservationId={cancelTarget?.id ?? null}
        paymentPending={
          cancelTarget
            ? getReservationPaymentState(cancelTarget) === "payment_pending"
            : false
        }
      />
    </NGOShell>
  );
}
