"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Clock3,
  ExternalLink,
  History,
  RefreshCw,
  ShieldAlert,
  SignalHigh,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import {
  formatDateTimeOrFallback,
  formatVisibleDateTimes,
} from "@/lib/dateTime";
import {
  formatGovernanceDate,
  formatGovernanceStatus,
  getGovernanceEventPresentation,
  governanceStatusBadge,
} from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminGovernanceDashboard,
} from "@/services/admin.service";
import type {
  GovernanceDashboardActivityRow,
  GovernanceDashboardCaseRow,
  GovernanceDashboardMetricCard,
  GovernanceDashboardNotification,
  GovernanceDashboardTrustActor,
  GovernanceProviderMetrics,
  GovernanceReporterReputation,
  GovernanceSignal,
  ModerationAppealRow,
} from "@shared/contracts/api-contracts";

const WINDOW_OPTIONS = [30, 90, 180, 365];

const RISK_STYLES: Record<string, string> = {
  HIGH: "border-red-200 bg-red-50 text-red-700",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-800",
  LOW: "border-blue-200 bg-blue-50 text-blue-700",
};

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.trunc(count) : 0;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return formatVisibleDateTimes(String(value));
}

function formatMetric(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return displayValue(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function sourceText(card: Pick<GovernanceDashboardMetricCard, "source">) {
  const predicate = card.source?.predicate;
  const table = card.source?.table;
  if (!table && !predicate) return "Existing governance records";
  return `${displayValue(table)} | ${displayValue(predicate)}`;
}

function riskBadge(risk: unknown) {
  const key = String(risk || "LOW").toUpperCase();
  return RISK_STYLES[key] || "border-zinc-200 bg-zinc-100 text-zinc-700";
}

function rowHref(row: { href?: unknown }, fallback: string) {
  return typeof row.href === "string" && row.href ? row.href : fallback;
}

function MetricLinkCard({ card }: { card: GovernanceDashboardMetricCard }) {
  return (
    <Link
      href={card.href}
      className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 hover:shadow"
      title={sourceText(card)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-600">{card.label}</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {formatMetric(card.value)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {card.source.windowed ? "Selected window" : "Current status"}
          </p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 text-zinc-500" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        {sourceText(card)}
      </p>
    </Link>
  );
}

function SectionPanel({
  title,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        {actionHref && (
          <Link
            href={actionHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-zinc-700 hover:text-zinc-950"
          >
            {actionLabel || "Open"}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function CaseRows({
  cases,
  empty,
}: {
  cases: GovernanceDashboardCaseRow[];
  empty: string;
}) {
  if (cases.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title={empty} />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {cases.slice(0, 8).map((item) => (
        <li key={String(item.id)} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link
                href={item.href}
                className="text-sm font-semibold text-zinc-950 hover:underline"
              >
                {displayValue(item.subject_name)}
              </Link>
              <p className="mt-1 text-xs text-zinc-500">
                {formatGovernanceStatus(item.reason || item.report_reason)} |{" "}
                {displayValue(item.listing_title || item.summary)}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${governanceStatusBadge(
                item.status
              )}`}
            >
              {formatGovernanceStatus(item.status)}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-3">
            <span>Opened {formatGovernanceDate(item.created_at)}</span>
            <span>Responses {toCount(item.provider_response_count)}</span>
            <span>Appeals {toCount(item.appeal_count)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AppealRows({
  appeals,
  empty,
}: {
  appeals: ModerationAppealRow[];
  empty: string;
}) {
  if (appeals.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title={empty} />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {appeals.slice(0, 6).map((appeal) => (
        <li key={String(appeal.id)} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link
                href={rowHref(
                  appeal as { href?: unknown },
                  `/admin/moderation-cases/${String(appeal.case_id)}`
                )}
                className="text-sm font-semibold text-zinc-950 hover:underline"
              >
                {displayValue(appeal.provider_name)}
              </Link>
              <p className="mt-1 text-xs text-zinc-500">
                {formatGovernanceStatus(appeal.report_reason || appeal.case_reason)} |{" "}
                {displayValue(appeal.listing_title || appeal.case_summary)}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${governanceStatusBadge(
                appeal.status
              )}`}
            >
              {formatGovernanceStatus(appeal.status)}
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Submitted {formatGovernanceDate(appeal.submitted_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function TrustActorRows({
  actors,
  empty,
}: {
  actors: GovernanceDashboardTrustActor[];
  empty: string;
}) {
  if (actors.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title={empty} />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {actors.slice(0, 6).map((actor) => (
        <li key={`${actor.subject_type}-${String(actor.subject_id)}`} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link
                href={actor.href}
                className="text-sm font-semibold text-zinc-950 hover:underline"
              >
                {displayValue(actor.actor_name || actor.subject_id)}
              </Link>
              <p className="mt-1 text-xs text-zinc-500">
                {formatGovernanceStatus(actor.subject_type)} | Updated{" "}
                {formatGovernanceDate(actor.updated_at)}
              </p>
            </div>
            <span className="inline-flex w-fit rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
              {formatGovernanceStatus(actor.risk_category)}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-4">
            <span>Score {formatMetric(actor.trust_score)}</span>
            <span>Restriction {formatMetric(actor.restriction_level)}</span>
            <span>Deposit {formatMetric(actor.deposit_multiplier)}x</span>
            <span>Cooldown {formatDateTimeOrFallback(actor.cooldown_until ?? null)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SignalRows({ signals }: { signals: GovernanceSignal[] }) {
  if (signals.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No governance signals in this window." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {signals.slice(0, 8).map((signal) => (
        <li key={signal.id} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-950">{signal.title}</p>
              <p className="mt-1 text-sm text-zinc-600">{signal.reason}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {displayValue(signal.actor_name)} |{" "}
                {formatGovernanceStatus(signal.actor_type)}
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
        </li>
      ))}
    </ul>
  );
}

function ActorRiskRows({
  providers,
  reporters,
}: {
  providers: GovernanceProviderMetrics[];
  reporters: GovernanceReporterReputation[];
}) {
  const rows = [
    ...providers.map((provider) => ({
      id: `provider-${String(provider.provider_id)}`,
      name: provider.provider_name,
      role: "provider",
      risk: provider.risk_level,
      detail: `${toCount(provider.cases_escalated)} escalated | ${toCount(provider.appeals_submitted)} appeals`,
      href: `/admin/trust?subjectType=provider&subjectId=${String(provider.provider_id)}`,
    })),
    ...reporters.map((reporter) => ({
      id: `reporter-${String(reporter.reporter_id)}`,
      name: reporter.reporter_name,
      role: reporter.reporter_role,
      risk: reporter.risk_level,
      detail: `${toCount(reporter.reports_dismissed)} dismissed | ${toCount(reporter.accepted_appeal_reversals)} reversals`,
      href: `/admin/governance-intelligence?reporterId=${String(reporter.reporter_id)}`,
    })),
  ];

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No high-risk actors in this window." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {rows.slice(0, 8).map((row) => (
        <li key={row.id} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link
                href={row.href}
                className="text-sm font-semibold text-zinc-950 hover:underline"
              >
                {displayValue(row.name)}
              </Link>
              <p className="mt-1 text-xs text-zinc-500">
                {formatGovernanceStatus(row.role)} | {row.detail}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${riskBadge(
                row.risk
              )}`}
            >
              {formatGovernanceStatus(row.risk)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityRows({
  activity,
}: {
  activity: GovernanceDashboardActivityRow[];
}) {
  if (activity.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No recent moderation activity in this window." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {activity.slice(0, 10).map((event) => {
        const presentation = getGovernanceEventPresentation(event);
        return (
          <li key={`${event.source_type}-${String(event.id)}`} className="px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Link
                  href={event.href}
                  className="text-sm font-semibold text-zinc-950 hover:underline"
                >
                  {presentation.title}
                </Link>
                <p className="mt-1 text-sm text-zinc-600">
                  {presentation.description || displayValue(event.subject_name)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {displayValue(event.actor_name || event.actor_role)} |{" "}
                  {displayValue(event.source?.table)}
                </p>
              </div>
              <span className="text-xs text-zinc-500">
                {formatGovernanceDate(event.created_at)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function NotificationRows({
  notifications,
}: {
  notifications: GovernanceDashboardNotification[];
}) {
  if (notifications.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No governance notifications in this window." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {notifications.slice(0, 8).map((notification) => (
        <li key={String(notification.id)} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link
                href={notification.href}
                className="text-sm font-semibold text-zinc-950 hover:underline"
              >
                {displayValue(notification.title || formatGovernanceStatus(notification.type))}
              </Link>
              <p className="mt-1 text-sm text-zinc-600">
                {displayValue(notification.message)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Recipient {displayValue(notification.recipient_name || notification.user_id)}
              </p>
            </div>
            <span className="text-xs text-zinc-500">
              {formatGovernanceDate(notification.created_at)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function GovernanceDashboardPage() {
  const [windowDays, setWindowDays] = useState(90);
  const [dashboard, setDashboard] = useState<AdminGovernanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(
    async (isActive: () => boolean = () => true) => {
      try {
        if (isActive()) {
          setLoading(true);
          setError("");
        }
        const result = await adminService.getGovernanceDashboard({
          windowDays,
          limit: 25,
        });
        if (isActive()) setDashboard(result);
      } catch (err) {
        if (isActive()) setError(adminService.getErrorMessage(err));
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [windowDays]
  );

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      void loadDashboard(() => active);
    });

    return () => {
      active = false;
    };
  }, [loadDashboard]);

  return (
    <AdminShell
      title="Governance Dashboard"
      description="A read-only operations center for moderation, appeals, trust, intelligence, and governance activity."
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
        <div className="flex gap-2">
          <Link
            href="/admin/audit-center?domains=governance,moderation,appeals,trust&limit=50"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Audit Center
          </Link>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
            disabled={loading}
            title="Refresh"
            aria-label="Refresh governance dashboard"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <AdminStateBlock title={error} tone="error" />}

      {loading && !dashboard ? (
        <AdminStateBlock title="Loading governance dashboard..." />
      ) : !dashboard ? (
        <AdminStateBlock title="Governance dashboard is unavailable." />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {dashboard.overview.cards.map((card) => (
              <MetricLinkCard key={card.id} card={card} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <SectionPanel
              title="Moderation Operations"
              actionHref={String(dashboard.moderation.hrefs?.queue || "/admin/provider-reports")}
              actionLabel="Queue"
            >
              <CaseRows
                cases={dashboard.moderation.current_queue || []}
                empty="No active moderation cases."
              />
            </SectionPanel>

            <div className="space-y-4">
              <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-50 text-zinc-700">
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">
                      Oldest Open Case
                    </p>
                    {dashboard.moderation.oldest_open_case ? (
                      <>
                        <Link
                          href={dashboard.moderation.oldest_open_case.href}
                          className="mt-1 block text-sm text-zinc-700 hover:underline"
                        >
                          {displayValue(dashboard.moderation.oldest_open_case.subject_name)}
                        </Link>
                        <p className="mt-1 text-xs text-zinc-500">
                          Opened{" "}
                          {formatGovernanceDate(
                            dashboard.moderation.oldest_open_case.created_at
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-zinc-600">No open case.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Link
                  href={String(
                    dashboard.moderation.hrefs?.awaiting_response ||
                      "/admin/provider-reports"
                  )}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm transition hover:border-amber-300"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    <p className="text-sm font-semibold">Awaiting Response</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold">
                    {toCount(dashboard.moderation.counts.awaiting_response_cases)}
                  </p>
                </Link>
                <Link
                  href={String(
                    dashboard.moderation.hrefs?.escalated ||
                      "/admin/provider-reports"
                  )}
                  className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm transition hover:border-red-300"
                >
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    <p className="text-sm font-semibold">Escalated</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold">
                    {toCount(dashboard.moderation.counts.escalated_cases)}
                  </p>
                </Link>
              </section>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <SectionPanel
              title="Appeals Operations"
              actionHref="/admin/moderation-appeals"
              actionLabel="Appeals"
            >
              <AppealRows
                appeals={[
                  ...(dashboard.appeals.pending || []),
                  ...(dashboard.appeals.under_review || []),
                ]}
                empty="No appeals pending review."
              />
            </SectionPanel>

            <SectionPanel title="Trust Visibility" actionHref="/admin/trust" actionLabel="Trust">
              <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Restricted
                  </p>
                  <p className="mt-1 text-xl font-semibold text-zinc-950">
                    {toCount(dashboard.trust.summary.restricted_actors)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Cooldown
                  </p>
                  <p className="mt-1 text-xl font-semibold text-zinc-950">
                    {toCount(dashboard.trust.summary.cooldown_actors)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Deposit
                  </p>
                  <p className="mt-1 text-xl font-semibold text-zinc-950">
                    {toCount(dashboard.trust.summary.high_deposit_multiplier_actors)}
                  </p>
                </div>
              </div>
              <TrustActorRows
                actors={dashboard.trust.visibility_actors || []}
                empty="No restricted, cooldown, or high-deposit actors."
              />
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <SectionPanel
              title="Governance Intelligence"
              actionHref={dashboard.intelligence.href}
              actionLabel="Full View"
            >
              <SignalRows signals={dashboard.intelligence.top_signals || []} />
            </SectionPanel>

            <SectionPanel
              title="High Risk Actors"
              actionHref="/admin/governance-intelligence?risk=HIGH"
              actionLabel="Risk"
            >
              <ActorRiskRows
                providers={dashboard.high_risk_actors.providers || []}
                reporters={dashboard.high_risk_actors.reporters || []}
              />
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <SectionPanel
              title="Recent Moderation Activity"
              actionHref="/admin/provider-reports?status=all"
              actionLabel="Cases"
            >
              <ActivityRows activity={dashboard.moderation.recent_activity || []} />
            </SectionPanel>

            <SectionPanel
              title="Governance Notifications"
              actionHref="/notifications"
              actionLabel="Notifications"
            >
              <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 text-xs text-zinc-500">
                <Bell className="h-4 w-4" aria-hidden="true" />
                <span>{displayValue(dashboard.notifications.source.predicate)}</span>
              </div>
              <NotificationRows
                notifications={dashboard.notifications.recent_activity || []}
              />
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <SectionPanel
              title="Escalation Providers"
              actionHref="/admin/governance-intelligence"
              actionLabel="Signals"
            >
              <SignalRows
                signals={dashboard.intelligence.high_escalation_providers || []}
              />
            </SectionPanel>
            <SectionPanel
              title="Appeal Reversals"
              actionHref="/admin/governance-intelligence"
              actionLabel="Signals"
            >
              <SignalRows
                signals={dashboard.intelligence.appeal_reversal_patterns || []}
              />
            </SectionPanel>
            <SectionPanel
              title="Repeated Targeting"
              actionHref="/admin/governance-intelligence"
              actionLabel="Signals"
            >
              <SignalRows
                signals={dashboard.intelligence.repeated_targeting_signals || []}
              />
            </SectionPanel>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <SignalHigh className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                <p className="text-sm font-semibold text-zinc-950">
                  Dashboard Lineage
                </p>
              </div>
              <p className="text-xs text-zinc-500">
                Generated {formatGovernanceDate(dashboard.generated_at)} | Window{" "}
                {dashboard.window.days} days
              </p>
            </div>
            <div className="mt-3 grid gap-3 text-xs text-zinc-600 md:grid-cols-3">
              <p>
                Moderation: moderation_cases and moderation_case_events current
                status/event records.
              </p>
              <p>
                Appeals: moderation_appeals and moderation_appeal_events current
                status/outcome records.
              </p>
              <p>
                Trust and signals: trust_scores, admin_trust_actions, and
                governanceIntelligence.service read models.
              </p>
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}
