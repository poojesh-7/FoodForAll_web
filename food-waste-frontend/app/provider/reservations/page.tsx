"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import { formatFoodDate, formatQuantityWithUnit } from "@/lib/food";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import {
  getReservationPaymentState,
  type ReservationPaymentState,
} from "@/lib/payment-flow";
import { mergeRealtimeRows } from "@/lib/realtimeMerge";
import {
  classifyReservationLifecycle,
  isHistoricalReservation,
} from "@/lib/reservationLifecycle";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { DbId, ProviderReservationRow } from "@shared/contracts/api-contracts";
import { useRouter } from "next/navigation";

type LifecycleView = "active" | "history";
type StatusFilter =
  | "all"
  | "active"
  | "payment_pending"
  | "reserved"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";
type TypeFilter = "all" | "ngo" | "user";
type PaymentFilter = "all" | "paid" | "pending" | "refunded";

function canConfirmPickup(reservation: ProviderReservationRow) {
  if (reservation.status !== "reserved") return false;
  if (reservation.pickup_type === "ngo") {
    return reservation.task_status === "in_progress";
  }
  return !["picked_up", "picked_from_provider", "delivered"].includes(
    String(reservation.task_status ?? "")
  );
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getReservationDisplayId(id?: DbId) {
  const raw = String(id ?? "").replace(/-/g, "");
  return `RES-${(raw.slice(-4) || "----").toUpperCase()}`;
}

function getReservationType(reservation: ProviderReservationRow): "ngo" | "user" {
  return reservation.pickup_type === "ngo" ||
    String(reservation.reservation_kind ?? "").toLowerCase() === "ngo"
    ? "ngo"
    : "user";
}

function getOperationalStatus(reservation: ProviderReservationRow): StatusFilter {
  const lifecycle = classifyReservationLifecycle(reservation);
  if (lifecycle.status === "payment_pending") return "payment_pending";
  if (lifecycle.status === "reserved") return "reserved";
  if (lifecycle.status === "in_progress") return "in_progress";
  if (lifecycle.status === "completed") return "completed";
  if (lifecycle.status === "cancelled") return "cancelled";
  if (lifecycle.status === "expired") return "expired";
  if (lifecycle.status === "failed") return "failed";
  return "active";
}

function getStatusLabel(status: StatusFilter) {
  const labels: Record<StatusFilter, string> = {
    all: "All",
    active: "Active",
    payment_pending: "Payment Pending",
    reserved: "Reserved",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
    expired: "Expired",
    failed: "Failed",
  };

  return labels[status];
}

function getStatusClasses(status: StatusFilter) {
  if (status === "reserved") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "in_progress") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "payment_pending") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }
  if (status === "cancelled" || status === "expired" || status === "failed") {
    return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }
  return "border-zinc-200 bg-white text-zinc-700";
}

function getPaymentFilterState(state: ReservationPaymentState): PaymentFilter {
  if (state === "paid" || state === "not_required") return "paid";
  if (state === "refunded" || state === "refund_pending") return "refunded";
  return "pending";
}

function matchesQuery(reservation: ProviderReservationRow, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const displayId = getReservationDisplayId(reservation.id).toLowerCase();
  const idSuffix = displayId.replace("res-", "");
  const requesterName = String(reservation.requester_name ?? "").toLowerCase();

  return (
    displayId.includes(normalizedQuery) ||
    idSuffix.includes(normalizedQuery.replace(/^res-/, "")) ||
    requesterName.includes(normalizedQuery)
  );
}

function filterReservations({
  reservations,
  lifecycle,
  query,
  statusFilter,
  typeFilter,
  paymentFilter,
}: {
  reservations: ProviderReservationRow[];
  lifecycle: LifecycleView;
  query: string;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  paymentFilter: PaymentFilter;
}) {
  return reservations.filter((reservation) => {
    const operationalStatus = getOperationalStatus(reservation);
    const reservationType = getReservationType(reservation);
    const paymentState = getReservationPaymentState(reservation);

    if (lifecycle === "active" && isHistoricalReservation(reservation)) {
      return false;
    }
    if (lifecycle === "history" && !isHistoricalReservation(reservation)) {
      return false;
    }
    if (statusFilter !== "all") {
      if (statusFilter === "active") {
        if (isHistoricalReservation(reservation)) return false;
      } else if (operationalStatus !== statusFilter) {
        return false;
      }
    }
    if (typeFilter !== "all" && reservationType !== typeFilter) return false;
    if (
      paymentFilter !== "all" &&
      getPaymentFilterState(paymentState) !== paymentFilter
    ) {
      return false;
    }

    return matchesQuery(reservation, query);
  });
}

function StatCard({
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

function CompactProgress({ reservation }: { reservation: ProviderReservationRow }) {
  const status = getOperationalStatus(reservation);
  const steps =
    getReservationType(reservation) === "ngo"
      ? ["reserved", "in_progress", "completed"]
      : ["reserved", "completed"];
  const currentIndex = Math.max(steps.indexOf(status), 0);

  if (status === "cancelled" || status === "expired") {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
        {getStatusLabel(status)}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {steps.map((step, index) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full ${
              index <= currentIndex ? "bg-zinc-950" : "bg-zinc-200"
            }`}
          />
        ))}
      </div>
      <div className="flex justify-between gap-2 text-[11px] font-medium text-zinc-500">
        {steps.map((step) => (
          <span key={step}>{getStatusLabel(step as StatusFilter)}</span>
        ))}
      </div>
    </div>
  );
}

export default function ProviderReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<ProviderReservationRow[]>([]);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleView>("active");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reservationVersion = useRealtimeStore((state) => state.reservationVersion);
  const reservationsById = useRealtimeStore((state) => state.reservations);

  useEffect(() => {
    let active = true;

    reservationService
      .getProviderReservations()
      .then((result) => {
        if (active) setReservations(result);
      })
      .catch((err) => {
        if (!active) return;
        const message = reservationService.getErrorMessage(err);
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
        mergeRealtimeRows<ProviderReservationRow>(current, reservationsById)
      )
    );
  }, [reservationVersion, reservationsById]);

  const activeReservations = useMemo(
    () => reservations.filter((reservation) => !isHistoricalReservation(reservation)),
    [reservations]
  );
  const historyReservations = useMemo(
    () => reservations.filter(isHistoricalReservation),
    [reservations]
  );
  const filteredReservations = useMemo(
    () =>
      filterReservations({
        reservations,
        lifecycle,
        query,
        statusFilter,
        typeFilter,
        paymentFilter,
      }),
    [lifecycle, paymentFilter, query, reservations, statusFilter, typeFilter]
  );

  const stats = useMemo(
    () => ({
      active: activeReservations.length,
      inProgress: activeReservations.filter(
        (reservation) => getOperationalStatus(reservation) === "in_progress"
      ).length,
      ngo: activeReservations.filter(
        (reservation) => getReservationType(reservation) === "ngo"
      ).length,
      history: historyReservations.length,
    }),
    [activeReservations, historyReservations]
  );

  const confirmPickup = async (reservation: ProviderReservationRow) => {
    if (!reservation.id) return;
    const reservationId = String(reservation.id);
    const pickupCode = pickupCodes[reservationId]?.trim();

    if (!pickupCode) {
      setError("Pickup code is required.");
      return;
    }

    try {
      setProcessingId(reservationId);
      setError("");
      setSuccess("");
      await reservationService.confirmPickup(reservation.id, {
        pickup_code: pickupCode,
      });
      setReservations((current) =>
        current.map((item) =>
          String(item.id) === reservationId
            ? {
                ...item,
                task_status:
                  reservation.pickup_type === "ngo"
                    ? "picked_from_provider"
                    : "picked_up",
                status:
                  reservation.pickup_type === "ngo" ? item.status : "picked_up",
                picked_up_at: new Date().toISOString(),
                completed_at:
                  reservation.pickup_type === "ngo"
                    ? item.completed_at
                    : new Date().toISOString(),
              }
            : item
        )
      );
      setPickupCodes((current) => ({ ...current, [reservationId]: "" }));
      setSuccess("Pickup confirmed.");
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  const renderReservation = (reservation: ProviderReservationRow) => {
    const reservationId: DbId | undefined = reservation.id;
    const id = String(reservationId ?? "");
    if (!id) return null;

    const confirmable = canConfirmPickup(reservation);
    const operationalStatus = getOperationalStatus(reservation);
    const reservationType = getReservationType(reservation);

    return (
      <article
        key={id}
        className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
      >
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-zinc-950">
                  {getReservationDisplayId(reservation.id)}
                </span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold uppercase text-zinc-600">
                  {reservationType}
                </span>
                <span
                  className={`rounded-md border px-2 py-1 text-xs font-semibold ${getStatusClasses(
                    operationalStatus
                  )}`}
                >
                  {getStatusLabel(operationalStatus)}
                </span>
              </div>
              <h2 className="mt-2 text-base font-semibold text-zinc-950">
                {displayValue(reservation.title)}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {displayValue(reservation.requester_name)} ·{" "}
                {displayValue(reservation.requester_phone)}
              </p>
            </div>
            <PaymentStatusBadge
              state={getReservationPaymentState(reservation)}
            />
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">
                Pickup Ends
              </p>
              <p className="mt-1 text-zinc-950">
                {formatFoodDate(reservation.pickup_end_time)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">
                Quantity
              </p>
              <p className="mt-1 text-zinc-950">
                {formatQuantityWithUnit(reservation.quantity_reserved, reservation)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">
                Volunteer
              </p>
              <p className="mt-1 text-zinc-950">
                {displayValue(reservation.assigned_volunteer_name)}
              </p>
            </div>
          </div>

          <CompactProgress reservation={reservation} />
        </div>

        <div className="border-t border-zinc-100 bg-zinc-50 p-4">
          {confirmable ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={pickupCodes[id] ?? ""}
                placeholder="Pickup code"
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                onChange={(event) =>
                  setPickupCodes((current) => ({
                    ...current,
                    [id]: event.target.value,
                  }))
                }
              />
              <button
                onClick={() => confirmPickup(reservation)}
                disabled={processingId === id}
                className="min-h-10 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {processingId === id ? "Confirming..." : "Confirm Pickup"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              Pickup confirmation becomes available when this reservation is ready.
            </p>
          )}
        </div>
      </article>
    );
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">
              Provider Reservations
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Track active pickups first, then review completed reservation history.
            </p>
          </div>
          <Link
            href="/provider/moderation-cases"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-950 transition hover:bg-white"
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Moderation
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
            Loading provider reservations...
          </div>
        ) : reservations.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No reservations found for your listings.
          </div>
        ) : (
          <div className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Active"
                value={stats.active}
                detail="Reservations needing attention"
              />
              <StatCard
                label="In Progress"
                value={stats.inProgress}
                detail="Pickup workflows underway"
              />
              <StatCard
                label="NGO"
                value={stats.ngo}
                detail="Active NGO reservations"
              />
              <StatCard
                label="History"
                value={stats.history}
                detail="Completed or inactive records"
              />
            </section>

            <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
                <input
                  value={query}
                  placeholder="Search RES-XXXX or requester"
                  className="min-h-10 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as StatusFilter)
                  }
                  className="min-h-10 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="payment_pending">Payment Pending</option>
                  <option value="reserved">Reserved</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                  <option value="failed">Failed</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={(event) =>
                    setTypeFilter(event.target.value as TypeFilter)
                  }
                  className="min-h-10 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  <option value="all">All types</option>
                  <option value="ngo">NGO</option>
                  <option value="user">User</option>
                </select>
                <select
                  value={paymentFilter}
                  onChange={(event) =>
                    setPaymentFilter(event.target.value as PaymentFilter)
                  }
                  className="min-h-10 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  <option value="all">All payments</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>

              <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-1">
                {(["active", "history"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setLifecycle(item)}
                    className={`min-h-10 flex-1 rounded px-3 text-sm font-medium transition ${
                      lifecycle === item
                        ? "bg-white text-zinc-950 shadow-sm"
                        : "text-zinc-600 hover:text-zinc-950"
                    }`}
                  >
                    {item === "active"
                      ? `Active (${activeReservations.length})`
                      : `History (${historyReservations.length})`}
                  </button>
                ))}
              </div>
            </section>

            {filteredReservations.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
                No reservations match the current view.
              </div>
            ) : (
              <section className="grid gap-4 xl:grid-cols-2">
                {filteredReservations.map(renderReservation)}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
