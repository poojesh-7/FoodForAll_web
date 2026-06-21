"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import IdentityChip from "@/components/identity/IdentityChip";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import NGOSummaryCard from "@/components/ngo/NGOSummaryCard";
import {
  formatDateTimeOrFallback,
  formatVisibleDateTimes,
} from "@/lib/dateTime";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { ngoService, type MyNGOProfile } from "@/services/ngo.service";
import { useAuthStore } from "@/store/authStore";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  ImpactSummary,
  NGOAssignedVolunteer,
  NGOIncomingRequest,
  NGOVolunteerJoinRequest,
} from "@shared/contracts/api-contracts";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function toMoney(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: unknown) {
  return `Rs. ${toMoney(value).toFixed(2)}`;
}

function hasActiveDate(value: unknown) {
  if (!value) return false;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function displayRestrictionReason(value: unknown) {
  return formatVisibleDateTimes(String(value || "Repeated missed rescue pickups"));
}

function shouldShowRestrictionAlert(ngo: MyNGOProfile | null) {
  if (!ngo) return false;
  return (
    toCount(ngo.restriction_level) > 0 ||
    Boolean(ngo.requires_reliability_deposit) ||
    toMoney(ngo.reliability_deposit_amount) > 0 ||
    hasActiveDate(ngo.cooldown_until) ||
    hasActiveDate(ngo.banned_until)
  );
}

export default function NGODashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [ngo, setNgo] = useState<MyNGOProfile | null>(null);
  const [impact, setImpact] = useState<ImpactSummary | null>(null);
  const [incomingRequests, setIncomingRequests] = useState<NGOIncomingRequest[]>([]);
  const [volunteerJoinRequests, setVolunteerJoinRequests] = useState<
    NGOVolunteerJoinRequest[]
  >([]);
  const [assignedVolunteers, setAssignedVolunteers] = useState<NGOAssignedVolunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [urgentSaving, setUrgentSaving] = useState(false);
  const [error, setError] = useState("");
  const volunteerVersion = useRealtimeStore((state) => state.volunteerVersion);

  const loadDashboard = useCallback(() => {
    let active = true;

    async function fetchDashboard() {
      try {
        setLoading(true);
        setError("");
        const profile = await ngoService.getMyNGO();
        const [
          impactResult,
          requests,
          volunteerRequests,
          assigned,
        ] = await Promise.all([
          profile.id
            ? ngoService.getNGOImpact(profile.id)
            : Promise.resolve<ImpactSummary>({
                total_pickups: 0,
                total_meals_saved: 0,
                estimated_co2_saved: 0,
              }),
          ngoService.getIncomingRequests(),
          ngoService.getVolunteerJoinRequests(),
          ngoService.getAssignedVolunteers(),
        ]);

        if (!active) return;
        setNgo(profile);
        setImpact(impactResult);
        setIncomingRequests(requests);
        setVolunteerJoinRequests(volunteerRequests);
        setAssignedVolunteers(assigned);
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

    fetchDashboard();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    return loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!volunteerVersion) return;
    return loadDashboard();
  }, [loadDashboard, volunteerVersion]);

  const rescueStats = useMemo(
    () => ({
      pickups: toCount(impact?.total_pickups),
      meals: toCount(impact?.total_meals_saved),
      co2: toCount(impact?.estimated_co2_saved),
      deliveries: toCount(impact?.delivery_pickups),
      deliveryMeals: toCount(impact?.delivery_meals_rescued),
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
          {shouldShowRestrictionAlert(ngo) && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <div className="flex gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-sm font-semibold text-amber-950">
                      Operational reliability alert
                    </h2>
                    <span className="text-xs font-semibold text-amber-800">
                      Restriction Level {toCount(ngo?.restriction_level)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-amber-800">Operational Deposit Required</p>
                      <p className="font-semibold text-zinc-950">
                        {formatMoney(ngo?.reliability_deposit_amount)} refundable
                      </p>
                    </div>
                    <div>
                      <p className="text-amber-800">Trust Score</p>
                      <p className="font-semibold text-zinc-950">
                        {String(ngo?.trust_score ?? "-")}
                      </p>
                    </div>
                    <div>
                      <p className="text-amber-800">Operational Status</p>
                      <p className="font-semibold text-zinc-950">
                        {hasActiveDate(ngo?.banned_until)
                          ? `Restricted until ${formatDateTimeOrFallback(
                              ngo?.banned_until ?? null
                            )}`
                          : hasActiveDate(ngo?.cooldown_until)
                            ? `Cooldown until ${formatDateTimeOrFallback(
                                ngo?.cooldown_until ?? null
                              )}`
                            : "Deposit required"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-amber-900">
                    Reason:{" "}
                    {displayRestrictionReason(ngo?.restriction_reason)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-900">
                    Successful rescues reduce future deposit requirements.
                  </p>
                </div>
              </div>
            </section>
          )}

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
              label="Delivery Impact"
              value={rescueStats.deliveryMeals}
              detail={`${rescueStats.deliveries} volunteer deliveries`}
            />
            <NGOSummaryCard
              label="Active Volunteers"
              value={assignedVolunteers.length}
              detail={`${volunteerJoinRequests.length} join requests pending`}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <IdentityChip
                    src={user?.profile_image_url ?? user?.profile_image}
                    name={String(ngo?.organization_name ?? "Your NGO")}
                    role="ngo"
                    label="NGO avatar"
                    caption="NGO"
                  />
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

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <NGOSummaryCard
                label="Service Radius"
                value={`${String(ngo?.service_radius_km ?? "-")} km`}
                detail="Coverage used for nearby food discovery"
              />
              <NGOSummaryCard
                label="Urgent Mode"
                value={ngo?.urgent_flag ? "On" : "Off"}
                detail={
                  ngo?.urgent_flag
                    ? "Prioritized for urgent rescue visibility"
                    : "Standard rescue visibility"
                }
              />
              <NGOSummaryCard
                label="CO2 Saved"
                value={`${rescueStats.co2}`}
                detail="Estimated kg from completed rescues"
              />
            </div>
          </section>
        </div>
      )}
    </NGOShell>
  );
}
