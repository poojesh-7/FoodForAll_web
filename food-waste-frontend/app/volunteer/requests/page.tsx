"use client";

import { useEffect, useState } from "react";
import VolunteerShell from "@/components/volunteer/VolunteerShell";
import VolunteerStateBlock from "@/components/volunteer/VolunteerStateBlock";
import IdentityChip from "@/components/identity/IdentityChip";
import { volunteerService } from "@/services/volunteer.service";
import type {
  VolunteerRequestAction,
  VolunteerRequestRow,
} from "@shared/contracts/api-contracts";

function isHandledConflict(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("already handled") || normalized.includes("not found");
}

export default function VolunteerRequestsPage() {
  const [requests, setRequests] = useState<VolunteerRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    volunteerService
      .getRequests()
      .then((result) => {
        if (active) setRequests(result);
      })
      .catch((err) => {
        if (active) setError(volunteerService.getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const respond = async (
    request: VolunteerRequestRow,
    action: VolunteerRequestAction
  ) => {
    if (!request.id) return;

    const requestId = String(request.id);
    const previousRequests = requests;

    setProcessingIds((current) => new Set(current).add(requestId));
    setRequests((current) =>
      current.filter((item) => String(item.id) !== requestId)
    );
    setError("");
    setSuccess("");

    try {
      await volunteerService.respondToRequest(request.id, { action });
      setSuccess(`Request ${action}.`);
    } catch (err) {
      const message = volunteerService.getErrorMessage(err);
      setError(
        isHandledConflict(message)
          ? `${message}. The request list has been updated.`
          : message
      );
      if (!isHandledConflict(message)) setRequests(previousRequests);
    } finally {
      setProcessingIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  };

  return (
    <VolunteerShell
      title="Volunteer Requests"
      description="Accept or reject NGO invitations to join their rescue operations."
    >
      {error && <VolunteerStateBlock title={error} tone="error" />}
      {success && <VolunteerStateBlock title={success} tone="success" />}

      {loading ? (
        <VolunteerStateBlock title="Loading NGO requests..." />
      ) : requests.length === 0 ? (
        <VolunteerStateBlock title="No pending NGO requests." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {requests.map((request) => {
            const requestId = String(request.id);
            const processing = processingIds.has(requestId);

            return (
              <article
                key={requestId}
                className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div>
                  <IdentityChip
                    src={request.ngo_profile_image_url}
                    name={request.organization_name}
                    role="ngo"
                    label="NGO avatar"
                    caption="NGO invitation"
                  />
                  <p className="mt-1 text-sm text-zinc-600">
                    Status: {request.status ?? "pending"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => respond(request, "accepted")}
                    disabled={processing}
                    className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => respond(request, "rejected")}
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
    </VolunteerShell>
  );
}
