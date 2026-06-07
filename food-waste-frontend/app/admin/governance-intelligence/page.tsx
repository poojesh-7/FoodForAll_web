"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import {
  formatGovernanceDate,
  formatGovernanceStatus,
} from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminGovernanceIntelligence,
} from "@/services/admin.service";
import type {
  GovernanceProviderMetrics,
  GovernanceReporterReputation,
  GovernanceSignal,
} from "@shared/contracts/api-contracts";

const WINDOW_OPTIONS = [30, 90, 180, 365];

const RISK_STYLES: Record<string, string> = {
  HIGH: "border-red-200 bg-red-50 text-red-700",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-800",
  LOW: "border-blue-200 bg-blue-50 text-blue-700",
};

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function formatRate(value: unknown) {
  const rate = Number(value ?? 0);
  if (!Number.isFinite(rate)) return "0%";
  return `${rate.toFixed(rate % 1 === 0 ? 0 : 1)}%`;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function riskBadge(risk: unknown) {
  const key = String(risk || "LOW").toUpperCase();
  return RISK_STYLES[key] || "border-zinc-200 bg-zinc-100 text-zinc-700";
}

function topSignals(signals: GovernanceSignal[]) {
  return signals.slice(0, 8);
}

function SignalList({ signals }: { signals: GovernanceSignal[] }) {
  if (signals.length === 0) {
    return <AdminStateBlock title="No governance signals in this window." />;
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {topSignals(signals).map((signal) => (
        <li key={signal.id} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-950">
                {signal.title}
              </p>
              <p className="mt-1 text-sm text-zinc-600">{signal.reason}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {displayValue(signal.actor_name)} | {formatGovernanceStatus(signal.actor_type)}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${riskBadge(
                signal.risk_level
              )}`}
            >
              {formatGovernanceStatus(signal.risk_level)}
            </span>
          </div>
          {Array.isArray(signal.supporting_counts) &&
            signal.supporting_counts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                {signal.supporting_counts.slice(0, 4).map((count) => (
                  <span key={`${signal.id}-${count.label}`}>
                    {count.label}: {displayValue(count.value)}
                  </span>
                ))}
              </div>
            )}
        </li>
      ))}
    </ul>
  );
}

function ReporterRows({
  reporters,
}: {
  reporters: GovernanceReporterReputation[];
}) {
  if (reporters.length === 0) {
    return <AdminStateBlock title="No reporter reputation data in this window." />;
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {reporters.slice(0, 8).map((reporter) => (
        <li key={String(reporter.reporter_id)} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-950">
                {displayValue(reporter.reporter_name)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatGovernanceStatus(reporter.reporter_role)} | Last report{" "}
                {formatGovernanceDate(reporter.last_report_at)}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${riskBadge(
                reporter.risk_level
              )}`}
            >
              {formatGovernanceStatus(reporter.risk_level)}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-4">
            <span>Submitted {toCount(reporter.reports_submitted)}</span>
            <span>Validated {toCount(reporter.reports_validated)}</span>
            <span>Dismissed {toCount(reporter.reports_dismissed)}</span>
            <span>Validation {formatRate(reporter.validation_rate)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProviderRows({
  providers,
}: {
  providers: GovernanceProviderMetrics[];
}) {
  if (providers.length === 0) {
    return <AdminStateBlock title="No provider governance data in this window." />;
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {providers.slice(0, 8).map((provider) => (
        <li key={String(provider.provider_id)} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-950">
                {displayValue(provider.provider_name)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Last case {formatGovernanceDate(provider.last_case_at)}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${riskBadge(
                provider.risk_level
              )}`}
            >
              {formatGovernanceStatus(provider.risk_level)}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-4">
            <span>Reports {toCount(provider.reports_received)}</span>
            <span>Appeals {toCount(provider.appeals_submitted)}</span>
            <span>Escalated {toCount(provider.cases_escalated)}</span>
            <span>Rate {formatRate(provider.escalation_rate)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function GovernanceIntelligencePage() {
  const searchParams = useSearchParams();
  const queryWindowDays = Number(
    searchParams.get("windowDays") || searchParams.get("window_days") || 90
  );
  const initialWindowDays = WINDOW_OPTIONS.includes(queryWindowDays)
    ? queryWindowDays
    : 90;
  const queryRisk = searchParams.get("risk") || undefined;
  const queryReporterId =
    searchParams.get("reporterId") || searchParams.get("reporter_id") || undefined;
  const queryProviderId =
    searchParams.get("providerId") || searchParams.get("provider_id") || undefined;
  const [windowDays, setWindowDays] = useState(initialWindowDays);
  const [intelligence, setIntelligence] =
    useState<AdminGovernanceIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadIntelligence = useCallback(
    async (isActive: () => boolean = () => true) => {
      try {
        if (isActive()) {
          setLoading(true);
          setError("");
        }
        const result = await adminService.getGovernanceIntelligence({
          windowDays,
          limit: 25,
          risk: queryRisk,
          reporterId: queryReporterId,
          providerId: queryProviderId,
        });
        if (isActive()) setIntelligence(result);
      } catch (err) {
        if (isActive()) setError(adminService.getErrorMessage(err));
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [queryProviderId, queryReporterId, queryRisk, windowDays]
  );

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      void loadIntelligence(() => active);
    });

    return () => {
      active = false;
    };
  }, [loadIntelligence]);

  const moderation = intelligence?.moderation;
  const escalation = intelligence?.escalation;

  return (
    <AdminShell
      title="Governance Intelligence"
      description="Review governance metrics, reputation patterns, and investigation signals."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
          {WINDOW_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setWindowDays(days)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                windowDays === days
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void loadIntelligence()}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
          disabled={loading}
          title="Refresh"
          aria-label="Refresh governance intelligence"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <AdminStateBlock title={error} tone="error" />}

      {loading && !intelligence ? (
        <AdminStateBlock title="Loading governance intelligence..." />
      ) : !intelligence || !moderation || !escalation ? (
        <AdminStateBlock title="Governance intelligence is unavailable." />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <AdminMetricCard
              label="Open Cases"
              value={toCount(moderation.open_cases)}
              detail="Current review queue"
            />
            <AdminMetricCard
              label="Validated"
              value={toCount(moderation.validated_cases)}
              detail="Case outcomes"
            />
            <AdminMetricCard
              label="Dismissed"
              value={toCount(moderation.dismissed_cases)}
              detail="Case outcomes"
            />
            <AdminMetricCard
              label="Appeals"
              value={toCount(moderation.appeals_submitted)}
              detail="Submitted"
            />
            <AdminMetricCard
              label="Accepted"
              value={toCount(moderation.appeals_accepted)}
              detail="Appeal outcomes"
            />
            <AdminMetricCard
              label="Escalation"
              value={formatRate(escalation.escalation_rate)}
              detail={`${toCount(escalation.cases_escalated)} cases`}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Governance Signals
                </h2>
              </div>
              <SignalList signals={intelligence.signals || []} />
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Escalation Analytics
                </h2>
              </div>
              <dl className="divide-y divide-zinc-100 text-sm">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-zinc-600">Cases escalated</dt>
                  <dd className="font-semibold text-zinc-950">
                    {toCount(escalation.cases_escalated)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-zinc-600">Escalation events</dt>
                  <dd className="font-semibold text-zinc-950">
                    {toCount(escalation.escalation_events)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-zinc-600">Repeated escalations</dt>
                  <dd className="font-semibold text-zinc-950">
                    {toCount(escalation.repeated_escalations)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-zinc-600">Average resolution</dt>
                  <dd className="font-semibold text-zinc-950">
                    {displayValue(moderation.average_resolution_hours)}h
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Reporter Reputation
                </h2>
              </div>
              <ReporterRows reporters={intelligence.reporters || []} />
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Provider Governance
                </h2>
              </div>
              <ProviderRows providers={intelligence.providers || []} />
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}
