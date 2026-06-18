"use client";

import { useEffect, useState } from "react";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import { formatPlatformDateTime, formatPlatformRelativeTime } from "@/lib/dateTime";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import {
  formatDistanceKm,
  formatQuantityWithUnit,
  getRescueRadiusKm,
  getRestaurantDisplayName,
  isOutsideRescueRadius,
} from "@/lib/food";
import { getPaymentSessionFromReservation } from "@/lib/payment-flow";
import { openReservationPaymentCheckout } from "@/lib/reservation-payment-checkout";
import { ngoService } from "@/services/ngo.service";
import type {
  AcceptNGORequestData,
  DbId,
  NGOIncomingRequest,
  PaymentCreateResult,
} from "@shared/contracts/api-contracts";
import { useRouter } from "next/navigation";

function isProcessedConflict(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already processed") ||
    normalized.includes("already taken") ||
    normalized.includes("not found")
  );
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatRelativeTime(value?: string | null) {
  return formatPlatformRelativeTime(value);
}

function formatPickupTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : formatPlatformDateTime(date);
}

function isNearExpiry(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  const remainingMs = time - Date.now();
  return remainingMs > 0 && remainingMs <= 60 * 60 * 1000;
}

function formatRadiusKm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function hasPaymentSession(
  payment?: PaymentCreateResult | null
): payment is PaymentCreateResult {
  return Boolean(payment?.order_id && payment.payment_session_id);
}

function isPaymentRequired(result: AcceptNGORequestData) {
  return (
    hasPaymentSession(result.payment) ||
    result.reservation?.status === "payment_pending" ||
    result.reservation?.payment_status === "pending" ||
    Boolean(result.policy?.requiresDeposit) ||
    Boolean(result.reservationCapacity?.depositRequired)
  );
}

async function getAcceptedRequestPaymentSession(result: AcceptNGORequestData) {
  const reservationId = result.reservation?.id;
  if (!reservationId) return null;

  if (hasPaymentSession(result.payment)) {
    return {
      orderId: result.payment.order_id,
      paymentSessionId: result.payment.payment_session_id,
      reservationId,
      listingId: result.reservation.listing_id,
    };
  }

  if (!isPaymentRequired(result)) return null;

  const reservations = await ngoService.getReservations();
  const latestReservation = reservations.find(
    (reservation) => String(reservation.id) === String(reservationId)
  );

  return getPaymentSessionFromReservation(latestReservation);
}

export default function NGOIncomingRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<NGOIncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [processingMessages, setProcessingMessages] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    ngoService
      .getIncomingRequests()
      .then((result) => {
        if (active) setRequests(result);
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

  const handleRequest = async (
    request: NGOIncomingRequest,
    action: "accept" | "reject"
  ) => {
    const requestId = String(request.request_id);
    const previousRequests = requests;

    setProcessingIds((current) => new Set(current).add(requestId));
    setProcessingMessages((current) => ({
      ...current,
      [requestId]: action === "accept" ? "Creating reservation..." : "Updating request...",
    }));
    setError("");
    setSuccess("");

    try {
      if (action === "accept") {
        const result = await ngoService.acceptRequest(request.request_id);
        setProcessingMessages((current) => ({
          ...current,
          [requestId]: "Preparing payment...",
        }));
        const paymentSession = await getAcceptedRequestPaymentSession(result);

        if (paymentSession) {
          setSuccess("Opening secure Cashfree checkout...");
          const checkoutResult = await openReservationPaymentCheckout(paymentSession);

          setSuccess(
            checkoutResult?.error?.message
              ? `${checkoutResult.error.message} The reservation remains payable from Reservations.`
              : "Payment is processing. You can resume or verify it from Reservations."
          );
          setRequests((current) =>
            current.filter((item) => String(item.request_id) !== requestId)
          );
          return;
        }
      } else {
        await ngoService.rejectRequest(request.request_id);
      }
      setRequests((current) =>
        current.filter((item) => String(item.request_id) !== requestId)
      );
      setSuccess(
        action === "accept"
          ? "Request accepted and reservation created."
          : "Request rejected."
      );
    } catch (err) {
      const message = ngoService.getErrorMessage(err);
      setError(
        isProcessedConflict(message)
          ? `${message}. The request list has been updated.`
          : message
      );

      if (!isProcessedConflict(message)) {
        setRequests(previousRequests);
      }
    } finally {
      setProcessingIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
      setProcessingMessages((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
    }
  };

  return (
    <NGOShell
      title="Incoming Requests"
      description="Accept or reject provider requests. Accepting locks the request through the backend reservation flow."
    >
      {error && <NGOStateBlock title={error} tone="error" />}
      {success && <NGOStateBlock title={success} tone="success" />}

      {loading ? (
        <NGOStateBlock title="Loading incoming requests..." />
      ) : requests.length === 0 ? (
        <NGOStateBlock
          title="No pending requests."
          description="Provider requests will appear here when restaurants ask your NGO to rescue a listing."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {requests.map((request) => {
            const requestId: DbId = request.request_id;
            const processing = processingIds.has(String(requestId));
            const processingMessage = processingMessages[String(requestId)];
            const nearExpiry = isNearExpiry(request.pickup_end_time);
            const distance = formatDistanceKm(request);
            const rescueRadiusKm = getRescueRadiusKm(request);
            const outsideRadius = isOutsideRescueRadius(request);

            return (
              <article
                key={String(requestId)}
                className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-zinc-950">
                      {displayValue(request.title)}
                    </h2>
                    <p className="mt-1 text-xs font-medium text-zinc-500">
                      Requested {formatRelativeTime(request.requested_at)}
                    </p>
                  </div>
                  <span className="w-fit shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                    {formatQuantityWithUnit(request.remaining_quantity, request)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  {distance && (
                    <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
                      {distance}
                    </span>
                  )}
                  {outsideRadius && rescueRadiusKm !== null && (
                    <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                      ⚠ Outside your rescue radius ({formatRadiusKm(rescueRadiusKm)} km)
                    </span>
                  )}
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs font-medium uppercase text-zinc-500">
                      Restaurant
                    </p>
                    <p className="mt-1 truncate font-semibold text-zinc-950">
                      {getRestaurantDisplayName(request)}
                    </p>
                    {request.provider_phone && (
                      <p className="mt-1 truncate text-zinc-600">
                        {request.provider_phone}
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium uppercase text-zinc-500">
                          Pickup Ends
                        </p>
                        <p className="mt-1 font-semibold text-zinc-950">
                          {formatPickupTime(request.pickup_end_time)}
                        </p>
                      </div>
                      {nearExpiry && (
                        <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                          Urgent
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {(request.trust_score !== undefined ||
                  request.restriction_level !== undefined) && (
                  <div className="flex flex-wrap gap-2 text-xs font-medium text-zinc-600">
                    {request.trust_score !== undefined && (
                      <span className="rounded-md border border-zinc-200 px-2 py-1">
                        Trust {displayValue(request.trust_score)}
                      </span>
                    )}
                    {request.restriction_level !== undefined && (
                      <span className="rounded-md border border-zinc-200 px-2 py-1">
                        Restriction level {displayValue(request.restriction_level)}
                      </span>
                    )}
                  </div>
                )}

                {processingMessage && (
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800">
                    {processingMessage}
                  </div>
                )}

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <button
                    onClick={() => handleRequest(request, "accept")}
                    disabled={processing}
                    className="min-h-10 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {processing ? processingMessage || "Processing..." : "Accept"}
                  </button>
                  <button
                    onClick={() => handleRequest(request, "reject")}
                    disabled={processing}
                    className="min-h-10 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </NGOShell>
  );
}
