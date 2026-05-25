"use client";

import { useEffect, useState } from "react";
import ImpactMetricGrid from "@/components/analytics/ImpactMetricGrid";
import ProviderReputation from "@/components/ratings/ProviderReputation";
import { getRoleDashboard } from "@/lib/onboarding";
import { impactService } from "@/services/impact.service";
import { ratingService } from "@/services/rating.service";
import { useAuthStore } from "@/store/authStore";
import type {
  ImpactSummary,
  ProviderRatingSummary,
} from "@shared/contracts/api-contracts";
import { useRouter } from "next/navigation";

function formatRestrictionDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : null;
}

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [userImpact, setUserImpact] = useState<ImpactSummary | null>(null);
  const [platformImpact, setPlatformImpact] = useState<ImpactSummary | null>(null);
  const [providerRatings, setProviderRatings] =
    useState<ProviderRatingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const dashboard = getRoleDashboard(user?.role);
    if (dashboard !== "/dashboard") {
      router.replace(dashboard);
    }
  }, [router, user?.role]);

  useEffect(() => {
    let active = true;

    async function loadAnalytics() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const [platform, personal, reputation] = await Promise.all([
          impactService.getPlatformImpact(),
          user.role === "user"
            ? impactService.getUserImpact(user.id)
            : Promise.resolve<ImpactSummary | null>(null),
          user.role === "provider"
            ? ratingService.getProviderRatings(user.id)
            : Promise.resolve<ProviderRatingSummary | null>(null),
        ]);

        if (!active) return;
        setPlatformImpact(platform);
        setUserImpact(personal);
        setProviderRatings(reputation);
      } catch (err) {
        if (active) setError(impactService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAnalytics();

    return () => {
      active = false;
    };
  }, [user?.id, user?.role]);

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Impact, reputation, and platform rescue totals.
            </p>
          </div>
        </header>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {user && Number("restriction_level" in user ? user.restriction_level ?? 0 : 0) > 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">
              Restriction level {String("restriction_level" in user ? user.restriction_level : 0)}
            </p>
            <p className="mt-1">
              {String(
                ("restriction_reason" in user && user.restriction_reason) ||
                  "Successful pickups gradually restore trust."
              )}
            </p>
            {"requires_reliability_deposit" in user &&
              user.requires_reliability_deposit && (
                <p className="mt-1">
                  Next eligible reservation may include a refundable reliability deposit of Rs.{" "}
                  {Number(user.reliability_deposit_amount ?? 0).toFixed(2)}.
                </p>
              )}
            {formatRestrictionDate("cooldown_until" in user ? user.cooldown_until : null) && (
              <p className="mt-1">
                Cooldown until{" "}
                {formatRestrictionDate("cooldown_until" in user ? user.cooldown_until : null)}
              </p>
            )}
            {formatRestrictionDate("banned_until" in user ? user.banned_until : null) && (
              <p className="mt-1">
                Temporarily unavailable until{" "}
                {formatRestrictionDate("banned_until" in user ? user.banned_until : null)}
              </p>
            )}
          </section>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading analytics...
          </div>
        ) : (
          <div className="space-y-6">
            {user?.role === "user" && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Your Impact
                </h2>
                <ImpactMetricGrid
                  columns="four"
                  metrics={[
                    {
                      label: "Total Pickups",
                      value: userImpact?.total_pickups,
                      detail: `${impactService.formatMetric(
                        userImpact?.self_pickups
                      )} self pickups`,
                    },
                    {
                      label: "Meals Saved",
                      value: userImpact?.total_meals_saved,
                      detail: "Reservation contribution",
                    },
                    {
                      label: "CO2 Saved",
                      value: userImpact?.estimated_co2_saved,
                      detail: "Estimated kg",
                      fractionDigits: 1,
                    },
                    {
                      label: "NGO Rescues",
                      value: userImpact?.ngo_meals_rescued,
                      detail: `${impactService.formatMetric(
                        userImpact?.ngo_pickups
                      )} completed pickups`,
                    },
                  ]}
                />
              </div>
            )}

            {user?.role === "provider" && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Provider Reputation
                </h2>
                <ProviderReputation summary={providerRatings} />
              </div>
            )}

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Platform Impact
              </h2>
              <ImpactMetricGrid
                columns="four"
                metrics={[
                  {
                    label: "Meals Saved",
                    value: platformImpact?.total_meals_saved,
                    detail: "Across completed pickups",
                  },
                  {
                    label: "Completed Pickups",
                    value: platformImpact?.total_pickups,
                    detail: "Platform-wide",
                  },
                  {
                    label: "CO2 Saved",
                    value: platformImpact?.estimated_co2_saved,
                    detail: "Estimated kg",
                    fractionDigits: 1,
                  },
                  {
                    label: "NGO Meals",
                    value: platformImpact?.ngo_meals_rescued,
                    detail: `${impactService.formatMetric(
                      platformImpact?.ngo_pickups
                    )} NGO pickups`,
                  },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
