"use client";

import { useCallback, useEffect, useState } from "react";
import VolunteerShell from "@/components/volunteer/VolunteerShell";
import VolunteerStateBlock from "@/components/volunteer/VolunteerStateBlock";
import { volunteerService } from "@/services/volunteer.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { DbId, VolunteerAvailableNGO } from "@backend/contracts/api-contracts";

export default function VolunteerNGOsPage() {
  const [ngos, setNgos] = useState<VolunteerAvailableNGO[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const volunteerVersion = useRealtimeStore((state) => state.volunteerVersion);

  const loadNGOs = useCallback(() => {
    let active = true;

    volunteerService
      .getAvailableNGOs()
      .then((result) => {
        if (active) setNgos(result);
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

  useEffect(() => {
    return loadNGOs();
  }, [loadNGOs]);

  useEffect(() => {
    if (!volunteerVersion) return;
    return loadNGOs();
  }, [loadNGOs, volunteerVersion]);

  const updateNGOStatus = (ngoId: DbId, status: string | null) => {
    setNgos((current) =>
      current.map((ngo) =>
        String(ngo.id) === String(ngoId) ? { ...ngo, volunteer_status: status } : ngo
      )
    );
  };

  const joinNGO = async (ngo: VolunteerAvailableNGO) => {
    setProcessingId(String(ngo.id));
    setError("");
    setSuccess("");

    try {
      await volunteerService.joinNGO({ ngo_id: ngo.id });
      updateNGOStatus(ngo.id, "pending");
      setSuccess(`Request sent to ${ngo.organization_name}.`);
    } catch (err) {
      setError(volunteerService.getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  const leaveNGO = async (ngo: VolunteerAvailableNGO) => {
    setProcessingId(String(ngo.id));
    setError("");
    setSuccess("");

    try {
      await volunteerService.leaveNGO({ ngo_id: ngo.id });
      updateNGOStatus(ngo.id, "left");
      setSuccess(`Left ${ngo.organization_name}.`);
    } catch (err) {
      setError(volunteerService.getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <VolunteerShell
      title="NGO Discovery"
      description="Find urgent NGOs first, then join or leave based on your current availability."
    >
      {error && <VolunteerStateBlock title={error} tone="error" />}
      {success && <VolunteerStateBlock title={success} tone="success" />}

      {loading ? (
        <VolunteerStateBlock title="Loading NGOs..." />
      ) : ngos.length === 0 ? (
        <VolunteerStateBlock title="No NGOs available." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {ngos.map((ngo) => {
            const joined = ngo.volunteer_status === "active";
            const pending = ngo.volunteer_status === "pending";
            const rejected = ngo.volunteer_status === "rejected";
            const processing = processingId === String(ngo.id);
            const statusLabel = joined ? "approved" : ngo.volunteer_status;

            return (
              <article
                key={String(ngo.id)}
                className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">
                      {ngo.organization_name}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {ngo.active_listings} active listings, {ngo.total_volunteers} volunteers
                    </p>
                    {statusLabel && (
                      <p className="mt-1 text-sm font-medium text-zinc-700">
                        Status: {statusLabel}
                      </p>
                    )}
                  </div>
                  {ngo.urgent_flag && (
                    <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                      Urgent
                    </span>
                  )}
                </div>

                <button
                  onClick={() => (joined ? leaveNGO(ngo) : joinNGO(ngo))}
                  disabled={processing || pending}
                  className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                    joined
                      ? "border border-zinc-300 text-zinc-950"
                      : "bg-zinc-950 text-white"
                  }`}
                >
                  {processing
                    ? "Updating..."
                    : joined
                      ? "Leave NGO"
                      : pending
                        ? "Pending Approval"
                        : rejected
                          ? "Request Again"
                          : "Request to Join"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </VolunteerShell>
  );
}
