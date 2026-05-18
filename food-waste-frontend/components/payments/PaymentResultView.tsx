"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PaymentStatusBadge from "@/components/payments/PaymentStatusBadge";
import ReservationCard from "@/components/reservations/ReservationCard";
import { openCashfreeCheckout } from "@/lib/cashfree";
import {
  getPaymentSessionByOrderId,
  getReservationPaymentState,
  isRetryablePaymentState,
  removePaymentSession,
} from "@/lib/payment-flow";
import { reservationService } from "@/services/reservation.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { ReservationDetails } from "@backend/contracts/api-contracts";

type PaymentResultViewProps = {
  expected: "success" | "failed";
};

const POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isMissingReservationMessage(message: string) {
  return /not found|404/i.test(message);
}

async function pollReservation(
  reservationId: string | number,
  pollPending: boolean,
  onUpdate: (reservation: ReservationDetails) => void
) {
  let latest: ReservationDetails | null = null;
  const attempts = pollPending ? POLL_ATTEMPTS : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await reservationService.getReservationById(reservationId);
    onUpdate(latest);

    const state = getReservationPaymentState(latest);
    if (state === "paid" || state === "failed" || state === "expired") {
      break;
    }

    if (pollPending) await delay(POLL_DELAY_MS);
  }

  return latest;
}

export default function PaymentResultView({ expected }: PaymentResultViewProps) {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id");
  const reservationIdParam = searchParams.get("reservation_id");
  const [reservation, setReservation] = useState<ReservationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const reservationVersion = useRealtimeStore((state) => state.reservationVersion);
  const reservationsById = useRealtimeStore((state) => state.reservations);

  const session = useMemo(() => getPaymentSessionByOrderId(orderId), [orderId]);
  const lookupReservationId = useMemo(
    () => session?.reservationId ?? reservationIdParam,
    [reservationIdParam, session]
  );
  const paymentState = reservation
    ? getReservationPaymentState(reservation)
    : "unknown";

  useEffect(() => {
    let active = true;

    async function loadInitialReservation() {
      if (!orderId && !reservationIdParam) {
        setError("Missing payment order or reservation id.");
        setLoading(false);
        return;
      }

      if (!lookupReservationId) {
        setError("Payment reservation id was not found in this browser or redirect URL.");
        setLoading(false);
        return;
      }

      try {
        setError("");
        setLoading(true);
        if (!session) {
          setMessage("Recovering reservation state from the payment redirect...");
        }

        const latest = await pollReservation(
          lookupReservationId,
          expected === "success",
          (nextReservation) => {
            if (active) setReservation(nextReservation);
          }
        );

        if (!active || !latest) return;

        const state = getReservationPaymentState(latest);
        if (state === "paid") {
          setMessage("Payment confirmed by the backend.");
          removePaymentSession({ orderId, reservationId: latest.id });
        } else if (state === "failed" || state === "expired") {
          setMessage("Payment did not complete. The backend state is shown below.");
          removePaymentSession({ orderId, reservationId: latest.id });
        } else {
          setMessage("Payment is still pending. Refresh after a moment.");
        }
      } catch (err) {
        if (!active) return;
        const message = reservationService.getErrorMessage(err);
        if (expected === "failed" && isMissingReservationMessage(message)) {
          setReservation(null);
          setError("");
          setMessage("Payment did not complete. No reservation was confirmed.");
          return;
        }
        setError(message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadInitialReservation();

    return () => {
      active = false;
    };
  }, [expected, lookupReservationId, orderId, reservationIdParam, session]);

  useEffect(() => {
    if (!reservationVersion || !lookupReservationId) return;
    const update = reservationsById[String(lookupReservationId)];
    if (!update) return;
    let active = true;

    queueMicrotask(() => {
      setReservation((current) =>
        current ? { ...current, ...update } : (update as ReservationDetails)
      );
    });

    reservationService
      .getReservationById(lookupReservationId)
      .then((latest) => {
        if (!active) return;
        setReservation({ ...latest, ...update });

        const state = getReservationPaymentState(latest);
        if (state === "paid") {
          setMessage("Payment confirmed by the backend.");
          removePaymentSession({ orderId, reservationId: latest.id });
        } else if (state === "failed" || state === "expired") {
          setMessage("Payment did not complete. The backend state is shown below.");
          removePaymentSession({ orderId, reservationId: latest.id });
        }
      })
      .catch((err) => {
        if (!active) return;
        const message = reservationService.getErrorMessage(err);
        if (isMissingReservationMessage(message)) {
          setReservation(null);
          setMessage("Payment did not complete. No reservation was confirmed.");
          return;
        }
        setError(message);
      });

    return () => {
      active = false;
    };
  }, [lookupReservationId, orderId, reservationVersion, reservationsById]);

  const loadReservation = async (pollPending: boolean) => {
    if (!orderId && !reservationIdParam) {
      setError("Missing payment order or reservation id.");
      setLoading(false);
      return null;
    }

    if (!lookupReservationId) {
      setError("Payment reservation id was not found in this browser or redirect URL.");
      setLoading(false);
      return null;
    }

    try {
      setError("");
      setLoading(true);
      return await pollReservation(
        lookupReservationId,
        pollPending,
        setReservation
      );
    } catch (err) {
      const message = reservationService.getErrorMessage(err);
      if (expected === "failed" && isMissingReservationMessage(message)) {
        setReservation(null);
        setMessage("Payment did not complete. No reservation was confirmed.");
      } else {
        setError(message);
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  const retryPayment = async () => {
    if (!session) return;

    try {
      setProcessing(true);
      setError("");
      setMessage("Opening secure Cashfree checkout...");
      const checkoutResult = await openCashfreeCheckout({
        paymentSessionId: session.paymentSessionId,
      });

      setMessage(
        checkoutResult?.error?.message || "Refreshing backend payment state..."
      );
      const latest = await loadReservation(true);
      if (latest && getReservationPaymentState(latest) === "paid") {
        setMessage("Payment confirmed by the backend.");
      }
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
      setMessage("");
    } finally {
      setProcessing(false);
    }
  };

  const title =
    paymentState === "paid"
      ? "Payment Confirmed"
      : expected === "success"
        ? "Payment Processing"
        : "Payment Not Completed";
  const canRetry = session && isRetryablePaymentState(paymentState);

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">{title}</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Reservation status is refreshed from the backend before anything is shown as final.
            </p>
          </div>
          <Link
            href="/reservations"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Reservations
          </Link>
        </header>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {message}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Verifying payment...
          </div>
        ) : reservation ? (
          <>
            <section className="flex flex-col justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Backend payment state
                </p>
                <div className="mt-2">
                  <PaymentStatusBadge state={paymentState} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => loadReservation(true)}
                  disabled={processing}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                >
                  Refresh
                </button>
                {canRetry && (
                  <button
                    type="button"
                    onClick={retryPayment}
                    disabled={processing}
                    className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {processing ? "Processing..." : "Retry Payment"}
                  </button>
                )}
                {!canRetry && reservation.listing_id && paymentState !== "paid" && (
                  <Link
                    href={`/food/${String(reservation.listing_id)}`}
                    className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                  >
                    Reserve Again
                  </Link>
                )}
              </div>
            </section>
            <ReservationCard
              reservation={reservation}
              href={`/reservations/${String(reservation.id ?? "")}`}
            />
          </>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No reservation details available.
          </div>
        )}
      </div>
    </main>
  );
}
