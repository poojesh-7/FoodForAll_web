"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import NGOSummaryCard from "@/components/ngo/NGOSummaryCard";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ngoService, type MyNGOProfile } from "@/services/ngo.service";
import type {
  ImpactSummary,
  NGOAssignedVolunteer,
  NGOIncomingRequest,
  NGOUnassignedVolunteer,
} from "@backend/contracts/api-contracts";
import { useRouter } from "next/navigation";

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export default function NGODashboardPage() {
  const router = useRouter();
  const [ngo, setNgo] = useState<MyNGOProfile | null>(null);
  const [impact, setImpact] = useState<ImpactSummary | null>(null);
  const [incomingRequests, setIncomingRequests] = useState<NGOIncomingRequest[]>([]);
  const [assignedVolunteers, setAssignedVolunteers] = useState<NGOAssignedVolunteer[]>([]);
  const [unassignedVolunteers, setUnassignedVolunteers] = useState<
    NGOUnassignedVolunteer[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [urgentSaving, setUrgentSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        setLoading(true);
        setError("");
        const profile = await ngoService.getMyNGO();
        const [impactResult, requests, assigned, unassigned] = await Promise.all([
          profile.id
            ? ngoService.getNGOImpact(profile.id)
            : Promise.resolve<ImpactSummary>({
                total_pickups: 0,
                total_meals_saved: 0,
                estimated_co2_saved: 0,
              }),
          ngoService.getIncomingRequests(),
          ngoService.getAssignedVolunteers(),
          ngoService.getUnassignedVolunteers(),
        ]);

        if (!active) return;
        setNgo(profile);
        setImpact(impactResult);
        setIncomingRequests(requests);
        setAssignedVolunteers(assigned);
        setUnassignedVolunteers(unassigned);
      } catch (err) {
        if (!active) return;
        const message = ngoService.getErrorMessage(err);
        if (isPendingVerificationError(message)) {
          router.push(pendingVerificationRoute);
          return;
        }
        setError(message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [router]);

  const rescueStats = useMemo(
    () => ({
      pickups: toCount(impact?.total_pickups),
      meals: toCount(impact?.total_meals_saved),
      co2: toCount(impact?.estimated_co2_saved),
    }),
    [impact]
  );

  const toggleUrgent = async () => {
    if (!ngo) return;

    const nextUrgent = !Boolean(ngo.urgent_flag);
    setNgo({ ...ngo, urgent_flag: nextUrgent });

    try {
      setUrgentSaving(true);
      setError("");
      await ngoService.setUrgent({ urgent_flag: nextUrgent });
    } catch (err) {
      setNgo({ ...ngo, urgent_flag: !nextUrgent });
      setError(ngoService.getErrorMessage(err));
    } finally {
      setUrgentSaving(false);
    }
  };

  return (
    <NGOShell
      title="NGO Dashboard"
      description="Coordinate rescues, requests, and volunteer coverage."
    >
      {error && <NGOStateBlock title={error} tone="error" />}

      {loading ? (
        <NGOStateBlock title="Loading NGO operations..." />
      ) : (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NGOSummaryCard
              label="Pending Requests"
              value={incomingRequests.length}
              detail="Provider requests awaiting response"
            />
            <NGOSummaryCard
              label="Meals Rescued"
              value={rescueStats.meals}
              detail={`${rescueStats.pickups} completed pickups`}
            />
            <NGOSummaryCard
              label="Active Volunteers"
              value={assignedVolunteers.length}
              detail={`${unassignedVolunteers.length} unassigned nearby`}
            />
            <NGOSummaryCard
              label="CO2 Saved"
              value={`${rescueStats.co2}`}
              detail="Estimated kg from completed rescues"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">
                    {String(ngo?.organization_name ?? "Your NGO")}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Service radius: {String(ngo?.service_radius_km ?? "-")} km
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(ngo?.urgent_flag)}
                  disabled={urgentSaving}
                  onClick={toggleUrgent}
                  className={`inline-flex items-center justify-between gap-3 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                    ngo?.urgent_flag
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-zinc-300 bg-white text-zinc-950"
                  }`}
                >
                  <span>Urgent mode</span>
                  <span
                    className={`h-5 w-9 rounded-full p-0.5 transition ${
                      ngo?.urgent_flag ? "bg-red-600" : "bg-zinc-300"
                    }`}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white transition ${
                        ngo?.urgent_flag ? "translate-x-4" : ""
                      }`}
                    />
                  </span>
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-1">
              <Link
                href="/ngo/nearby-listings"
                className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-950 shadow-sm transition hover:border-zinc-400"
              >
                Reserve nearby food
              </Link>
              <Link
                href="/ngo/incoming-requests"
                className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-950 shadow-sm transition hover:border-zinc-400"
              >
                Review provider requests
              </Link>
              <Link
                href="/ngo/reservations"
                className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-950 shadow-sm transition hover:border-zinc-400"
              >
                View reservations
              </Link>
              <Link
                href="/ngo/volunteers"
                className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-950 shadow-sm transition hover:border-zinc-400"
              >
                Manage volunteers
              </Link>
            </div>
          </section>
        </div>
      )}
    </NGOShell>
  );
}
