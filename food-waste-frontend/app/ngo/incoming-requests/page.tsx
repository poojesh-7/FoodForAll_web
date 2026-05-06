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

            return (
              <article
                key={String(requestId)}
                className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">
                      {request.title}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      Provider: {request.provider_name ?? "Unknown provider"}
                    </p>
                  </div>
                  <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                    {String(request.remaining_quantity)} items
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleRequest(request, "accept")}
                    disabled={processing}
                    className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleRequest(request, "reject")}
                    disabled={processing}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
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
