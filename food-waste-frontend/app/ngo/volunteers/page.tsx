"use client";

import { useCallback, useEffect, useState } from "react";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import IdentityChip from "@/components/identity/IdentityChip";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ngoService } from "@/services/ngo.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  NGOAssignedVolunteer,
  NGOVolunteerJoinRequest,
  NGOUnassignedVolunteer,
} from "@shared/contracts/api-contracts";
import { useRouter } from "next/navigation";

export default function NGOVolunteersPage() {
  const router = useRouter();
  const [assigned, setAssigned] = useState<NGOAssignedVolunteer[]>([]);
  const [joinRequests, setJoinRequests] = useState<NGOVolunteerJoinRequest[]>([]);
  const [unassigned, setUnassigned] = useState<NGOUnassignedVolunteer[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const volunteerVersion = useRealtimeStore((state) => state.volunteerVersion);

  const loadVolunteers = useCallback(() => {
    let active = true;

    Promise.all([
      ngoService.getAssignedVolunteers(),
      ngoService.getVolunteerJoinRequests(),
      ngoService.getUnassignedVolunteers(),
    ])
      .then(([assignedResult, joinRequestResult, unassignedResult]) => {
        if (!active) return;
        setAssigned(assignedResult);
        setJoinRequests(joinRequestResult);
        setUnassigned(unassignedResult);
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
    return loadVolunteers();
  }, [loadVolunteers]);

  useEffect(() => {
    if (!volunteerVersion) return;
    return loadVolunteers();
  }, [loadVolunteers, volunteerVersion]);

  const sendRequest = async (volunteer: NGOUnassignedVolunteer) => {
    const volunteerId = String(volunteer.id);
    setRequestingIds((current) => new Set(current).add(volunteerId));
    setError("");
    setSuccess("");

    try {
      await ngoService.requestVolunteer({ volunteer_id: volunteer.id });
      setRequestedIds((current) => new Set(current).add(volunteerId));
      setSuccess(`Request sent to ${volunteer.name ?? "volunteer"}.`);
    } catch (err) {
      setError(ngoService.getErrorMessage(err));
    } finally {
      setRequestingIds((current) => {
        const next = new Set(current);
        next.delete(volunteerId);
        return next;
      });
    }
  };

  const handleJoinRequest = async (
    request: NGOVolunteerJoinRequest,
    action: "approve" | "reject"
  ) => {
    const requestId = String(request.request_id);
    const previousRequests = joinRequests;

    setRequestingIds((current) => new Set(current).add(requestId));
    setJoinRequests((current) =>
      current.filter((item) => String(item.request_id) !== requestId)
    );
    setError("");
    setSuccess("");

    try {
      if (action === "approve") {
        await ngoService.approveVolunteerJoinRequest(request.request_id);
        setAssigned((current) => [
          {
            id: request.volunteer_id,
            name: request.volunteer_name,
            profile_image_url: request.volunteer_profile_image_url,
            status: "active",
          },
          ...current,
        ]);
      } else {
        await ngoService.rejectVolunteerJoinRequest(request.request_id);
      }

      setSuccess(
        action === "approve"
          ? "Volunteer request approved."
          : "Volunteer request rejected."
      );
    } catch (err) {
      setJoinRequests(previousRequests);
      setError(ngoService.getErrorMessage(err));
    } finally {
      setRequestingIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  };

  return (
    <NGOShell
      title="Volunteer Management"
      description="Track active volunteers and request unassigned volunteers to join your NGO."
    >
      {error && <NGOStateBlock title={error} tone="error" />}
      {success && <NGOStateBlock title={success} tone="success" />}

      {loading ? (
        <NGOStateBlock title="Loading volunteers..." />
      ) : (
        <div className="space-y-5">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">
                Incoming Volunteer Requests
              </h2>
              <p className="text-sm text-zinc-600">
                Review volunteer requests before they become active.
              </p>
            </div>

            {joinRequests.length === 0 ? (
              <NGOStateBlock title="No pending volunteer requests." />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {joinRequests.map((request) => {
                  const requestId = String(request.request_id);
                  const processing = requestingIds.has(requestId);

                  return (
                    <article
                      key={requestId}
                      className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
                    >
                      <div>
                        <IdentityChip
                          src={request.volunteer_profile_image_url}
                          name={request.volunteer_name ?? "Unnamed volunteer"}
                          role="volunteer"
                          label="Volunteer avatar"
                          caption={
                            request.is_available ? "Available" : "Availability unknown"
                          }
                        />
                        <p className="mt-1 text-sm text-zinc-600">
                          {request.is_available ? "Available" : "Availability unknown"}
                        </p>
                        {request.volunteer_phone && (
                          <p className="text-sm text-zinc-600">
                            Phone: {request.volunteer_phone}
                          </p>
                        )}
                        <p className="text-sm font-medium text-zinc-700">
                          Status: {request.status}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleJoinRequest(request, "approve")}
                          disabled={processing}
                          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleJoinRequest(request, "reject")}
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
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">
                Active Volunteers
              </h2>
              <p className="text-sm text-zinc-600">
                {assigned.length} volunteers currently assigned to your NGO.
              </p>
            </div>

            {assigned.length === 0 ? (
              <NGOStateBlock
                title="No active volunteers yet."
                description="Accepted volunteer requests will appear here."
              />
            ) : (
              <div className="space-y-3">
                {assigned.map((volunteer) => (
                  <article
                    key={String(volunteer.id)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
                  >
                    <IdentityChip
                      src={volunteer.profile_image_url}
                      name={volunteer.name ?? "Unnamed volunteer"}
                      role="volunteer"
                      label="Volunteer avatar"
                      caption={volunteer.status}
                    />
                    <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                      Active
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">
                Unassigned Volunteers
              </h2>
              <p className="text-sm text-zinc-600">
                Invite available volunteers who are not active in another NGO.
              </p>
            </div>

            {unassigned.length === 0 ? (
              <NGOStateBlock
                title="No unassigned volunteers found."
                description="New volunteers will appear here when they become available."
              />
            ) : (
              <div className="space-y-3">
                {unassigned.map((volunteer) => {
                  const volunteerId = String(volunteer.id);
                  const requested = requestedIds.has(volunteerId);
                  const requesting = requestingIds.has(volunteerId);

                  return (
                    <article
                      key={volunteerId}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
                    >
                      <IdentityChip
                        src={volunteer.profile_image_url}
                        name={volunteer.name ?? "Unnamed volunteer"}
                        role="volunteer"
                        label="Volunteer avatar"
                        caption={
                          volunteer.is_available ? "Available" : "Availability unknown"
                        }
                      />
                      <button
                        onClick={() => sendRequest(volunteer)}
                        disabled={requesting || requested}
                        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {requested ? "Requested" : requesting ? "Sending..." : "Send Request"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          </div>
        </div>
      )}
    </NGOShell>
  );
}
