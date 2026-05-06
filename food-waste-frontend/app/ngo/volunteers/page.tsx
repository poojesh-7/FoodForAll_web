"use client";

import { useEffect, useState } from "react";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ngoService } from "@/services/ngo.service";
import type {
  NGOAssignedVolunteer,
  NGOUnassignedVolunteer,
} from "@backend/contracts/api-contracts";
import { useRouter } from "next/navigation";

export default function NGOVolunteersPage() {
  const router = useRouter();
  const [assigned, setAssigned] = useState<NGOAssignedVolunteer[]>([]);
  const [unassigned, setUnassigned] = useState<NGOUnassignedVolunteer[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    Promise.all([
      ngoService.getAssignedVolunteers(),
      ngoService.getUnassignedVolunteers(),
    ])
      .then(([assignedResult, unassignedResult]) => {
        if (!active) return;
        setAssigned(assignedResult);
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
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-950">
                        {volunteer.name ?? "Unnamed volunteer"}
                      </h3>
                      <p className="text-sm text-zinc-600">{volunteer.status}</p>
                    </div>
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
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-950">
                          {volunteer.name ?? "Unnamed volunteer"}
                        </h3>
                        <p className="text-sm text-zinc-600">
                          {volunteer.is_available ? "Available" : "Availability unknown"}
                        </p>
                      </div>
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
      )}
    </NGOShell>
  );
}
