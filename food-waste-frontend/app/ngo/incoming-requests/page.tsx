"use client";

import { useEffect, useState } from "react";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ngoService } from "@/services/ngo.service";
import type { DbId, NGOIncomingRequest } from "@backend/contracts/api-contracts";
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
  if (!value) return "Just now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Just now";

  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function formatPickupTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function isNearExpiry(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  const remainingMs = time - Date.now();
  return remainingMs > 0 && remainingMs <= 60 * 60 * 1000;
}

export default function NGOIncomingRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<NGOIncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
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
    setRequests((current) =>
      current.filter((item) => String(item.request_id) !== requestId)
    );
    setError("");
    setSuccess("");

    try {
      if (action === "accept") {
        await ngoService.acceptRequest(request.request_id);
      } else {
        await ngoService.rejectRequest(request.request_id);
      }
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
            const nearExpiry = isNearExpiry(request.pickup_end_time);

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
                    {String(request.remaining_quantity)} items
                  </span>
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs font-medium uppercase text-zinc-500">
                      Provider
                    </p>
                    <p className="mt-1 truncate font-semibold text-zinc-950">
                      {displayValue(request.provider_name)}
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

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <button
                    onClick={() => handleRequest(request, "accept")}
                    disabled={processing}
                    className="min-h-10 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Accept
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
