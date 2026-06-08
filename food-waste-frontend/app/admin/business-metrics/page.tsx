"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Database,
  Download,
  FileJson,
  History,
  LineChart,
  RefreshCw,
  Scale,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminBusinessMetrics,
} from "@/services/admin.service";
import type {
  BusinessMetricSource,
  BusinessPlatformPeriodSummary,
  BusinessRankingRow,
  BusinessTrendPoint,
} from "@shared/contracts/api-contracts";

const PERIOD_OPTIONS = [
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "180d", label: "180d" },
  { key: "365d", label: "365d" },
  { key: "all", label: "All Time" },
] as const;

type ExportFormat = "csv" | "json";

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Number.isInteger(number) ? number.toLocaleString() : number.toFixed(2);
  }
  return String(value);
}

function label(value: unknown) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceText(source?: BusinessMetricSource | null) {
  if (!source) return "Existing read models";
  return [source.table, source.predicate].filter(Boolean).join(" | ");
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function MetricTile({
  label: metricLabel,
  value,
  detail,
  tone = "zinc",
}: {
  label: string;
  value: unknown;
  detail?: string;
  tone?: "zinc" | "emerald" | "blue" | "amber" | "rose";
}) {
  const tones = {
    zinc: "border-zinc-200 bg-white text-zinc-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
  };

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-medium uppercase text-zinc-500">{metricLabel}</p>
      <p className="mt-2 text-2xl font-semibold">{displayValue(value)}</p>
      {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
    </div>
  );
}

function SectionPanel({
  title,
  icon,
  source,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  source?: BusinessMetricSource | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        </div>
        {source && (
          <p className="max-w-xl truncate text-xs text-zinc-500" title={sourceText(source)}>
            {sourceText(source)}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function RankingList({
  rows,
  nameKey,
  valueKey,
  empty,
}: {
  rows: BusinessRankingRow[];
  nameKey: keyof BusinessRankingRow;
  valueKey: keyof BusinessRankingRow;
  empty: string;
}) {
  if (!rows.length) {
    return (
      <div className="p-4">
        <AdminStateBlock title={empty} />
      </div>
    );
  }

  return (
    <ol className="divide-y divide-zinc-100">
      {rows.slice(0, 8).map((row, index) => (
        <li
          key={`${String(row[nameKey] || "row")}-${index}`}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-950">
              {displayValue(row[nameKey])}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Rank {index + 1}</p>
          </div>
          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm font-semibold text-zinc-800">
            {displayValue(row[valueKey])}
          </span>
        </li>
      ))}
    </ol>
  );
}

function PeriodSummaryTable({
  summaries,
}: {
  summaries: BusinessPlatformPeriodSummary[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Window</th>
            <th className="px-4 py-3 font-semibold">Food Listings Created</th>
            <th className="px-4 py-3 font-semibold">Reservations</th>
            <th className="px-4 py-3 font-semibold">Pickups</th>
            <th className="px-4 py-3 font-semibold">Deliveries</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {summaries.map((summary) => (
            <tr key={summary.period}>
              <td className="px-4 py-3 font-medium text-zinc-950">{summary.label}</td>
              <td className="px-4 py-3">{displayValue(summary.total_food_listings)}</td>
              <td className="px-4 py-3">{displayValue(summary.total_reservations)}</td>
              <td className="px-4 py-3">{displayValue(summary.completed_pickups)}</td>
              <td className="px-4 py-3">{displayValue(summary.completed_deliveries)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendTable({ series }: { series: BusinessTrendPoint[] }) {
  const rows = series.slice(-14);
  if (!rows.length) return <AdminStateBlock title="No trend data available." />;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Listings Created</th>
            <th className="px-4 py-3 font-semibold">Reservations</th>
            <th className="px-4 py-3 font-semibold">Deliveries</th>
            <th className="px-4 py-3 font-semibold">Reports</th>
            <th className="px-4 py-3 font-semibold">Settlements</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((point) => (
            <tr key={point.bucket}>
              <td className="px-4 py-3 font-medium text-zinc-950">{point.bucket}</td>
              <td className="px-4 py-3">{displayValue(point.listings)}</td>
              <td className="px-4 py-3">{displayValue(point.reservations)}</td>
              <td className="px-4 py-3">{displayValue(point.deliveries)}</td>
              <td className="px-4 py-3">{displayValue(point.reports)}</td>
              <td className="px-4 py-3">{displayValue(point.settlements)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BusinessMetricsPage() {
  const [period, setPeriod] = useState("30d");
  const [metrics, setMetrics] = useState<AdminBusinessMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [error, setError] = useState("");

  const trendTotals = useMemo(() => {
    const empty = { listings: 0, reservations: 0, deliveries: 0, reports: 0, settlements: 0 };
    return (metrics?.trend_analytics.series || []).reduce(
      (acc, point) => ({
        listings: acc.listings + toNumber(point.listings),
        reservations: acc.reservations + toNumber(point.reservations),
        deliveries: acc.deliveries + toNumber(point.deliveries),
        reports: acc.reports + toNumber(point.reports),
        settlements: acc.settlements + toNumber(point.settlements),
      }),
      empty
    );
  }, [metrics]);

  const loadMetrics = useCallback(
    async (isActive: () => boolean = () => true) => {
      try {
        if (isActive()) {
          setLoading(true);
          setError("");
        }
        const result = await adminService.getBusinessMetrics({ period });
        if (isActive()) setMetrics(result);
      } catch (err) {
        if (isActive()) setError(adminService.getErrorMessage(err));
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [period]
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      void loadMetrics(() => active);
    });
    return () => {
      active = false;
    };
  }, [loadMetrics]);

  const exportCurrent = async (format: ExportFormat) => {
    try {
      setExporting(format);
      setError("");
      const result = await adminService.exportBusinessMetrics(format, { period });
      downloadBlob(result.blob, result.filename);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <AdminShell
      title="Business Metrics"
      description="Read-only platform, participation, trust, governance, financial, and trend analytics."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setPeriod(option.key)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                period === option.key
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/audit-center?domains=governance&q=business_metrics_exported&limit=50"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Audit Center
          </Link>
          <button
            type="button"
            onClick={() => void exportCurrent("csv")}
            disabled={exporting !== null || !metrics}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => void exportCurrent("json")}
            disabled={exporting !== null || !metrics}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
          >
            <FileJson className="h-4 w-4" aria-hidden="true" />
            JSON
          </button>
          <button
            type="button"
            onClick={() => void loadMetrics()}
            disabled={loading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh business metrics"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <AdminStateBlock title={error} tone="error" />}

      {loading && !metrics ? (
        <AdminStateBlock title="Loading business metrics..." />
      ) : !metrics ? (
        <AdminStateBlock title="Business metrics are unavailable." />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.platform.cards.map((card, index) => (
              <MetricTile
                key={card.id}
                label={card.label}
                value={card.value}
                detail={sourceText(card.source)}
                tone={index === 0 ? "emerald" : index === 1 ? "blue" : "zinc"}
              />
            ))}
          </section>

          <SectionPanel
            title="Platform Overview"
            icon={<BarChart3 className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            source={metrics.platform.selected.source}
          >
            <PeriodSummaryTable summaries={metrics.platform.period_summaries || []} />
          </SectionPanel>

          <SectionPanel
            title="Current Listing Inventory"
            icon={<Database className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            source={metrics.listing_inventory.source}
          >
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label="Active Listings"
                value={metrics.listing_inventory.active_listings}
                detail="Available now"
                tone="emerald"
              />
              <MetricTile
                label="Archived Listings"
                value={metrics.listing_inventory.archived_listings}
                detail="Deleted or archived"
              />
              <MetricTile
                label="Expired Listings"
                value={metrics.listing_inventory.expired_listings}
                detail="Past pickup window"
                tone="amber"
              />
              <MetricTile
                label="Fulfilled Listings"
                value={metrics.listing_inventory.fulfilled_listings}
                detail="Completed or zero remaining"
                tone="blue"
              />
            </div>
          </SectionPanel>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <SectionPanel
              title="Food Rescue Metrics"
              icon={<Scale className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.food_rescue.source}
            >
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                <MetricTile
                  label="Total Food Rescued"
                  value={metrics.food_rescue.total_food_rescued}
                  detail={label(metrics.food_rescue.unit)}
                  tone="emerald"
                />
                <MetricTile
                  label="Completed Reservations"
                  value={metrics.food_rescue.completed_reservations}
                />
                <MetricTile
                  label="Source Listing Quantity"
                  value={metrics.food_rescue.source_listing_quantity_total}
                />
              </div>
            </SectionPanel>

            <SectionPanel
              title="Reservation Performance"
              icon={<LineChart className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.reservation_performance.source}
            >
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                <MetricTile label="Created" value={metrics.reservation_performance.created} />
                <MetricTile label="Completed" value={metrics.reservation_performance.completed} tone="emerald" />
                <MetricTile label="Cancelled" value={metrics.reservation_performance.cancelled} tone="rose" />
                <MetricTile label="Expired" value={metrics.reservation_performance.expired} tone="amber" />
                <MetricTile label="Completion Rate" value={`${displayValue(metrics.reservation_performance.completion_rate)}%`} />
                <MetricTile label="Cancellation Rate" value={`${displayValue(metrics.reservation_performance.cancellation_rate)}%`} />
              </div>
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <SectionPanel
              title="Provider Participation"
              icon={<Users className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.provider_participation.source}
            >
              <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <MetricTile label="Active Providers" value={metrics.provider_participation.counts.active_providers} />
                <MetricTile label="New Providers" value={metrics.provider_participation.counts.new_providers} />
                <MetricTile label="Verified Providers" value={metrics.provider_participation.counts.verified_providers} />
              </div>
              <RankingList rows={metrics.provider_participation.top_providers.by_listings || []} nameKey="provider_name" valueKey="listings" empty="No provider listings in this period." />
            </SectionPanel>

            <SectionPanel
              title="NGO Participation"
              icon={<Users className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.ngo_participation.source}
            >
              <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-2">
                <MetricTile label="Active NGOs" value={metrics.ngo_participation.counts.active_ngos} />
                <MetricTile label="Verified NGOs" value={metrics.ngo_participation.counts.verified_ngos} />
                <MetricTile label="New NGOs" value={metrics.ngo_participation.counts.new_ngos} />
                <MetricTile label="Successful Deliveries" value={metrics.ngo_participation.counts.successful_deliveries} />
              </div>
              <RankingList rows={metrics.ngo_participation.top_ngos.by_deliveries || []} nameKey="ngo_name" valueKey="deliveries" empty="No NGO deliveries in this period." />
            </SectionPanel>

            <SectionPanel
              title="Volunteer Participation"
              icon={<Truck className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.volunteer_participation.source}
            >
              <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <MetricTile label="Active Volunteers" value={metrics.volunteer_participation.counts.active_volunteers} />
                <MetricTile label="Completed Deliveries" value={metrics.volunteer_participation.counts.completed_deliveries} tone="emerald" />
                <MetricTile label="Completion Rate" value={`${displayValue(metrics.volunteer_participation.counts.completion_rate)}%`} />
              </div>
              <RankingList rows={metrics.volunteer_participation.top_volunteers.by_deliveries || []} nameKey="volunteer_name" valueKey="deliveries" empty="No volunteer deliveries in this period." />
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <SectionPanel
              title="Trust Insights"
              icon={<ShieldCheck className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.trust_insights.source}
            >
              <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <MetricTile label="Average Trust Score" value={metrics.trust_insights.average_trust_score} />
                <MetricTile label="Restricted Entities" value={metrics.trust_insights.restricted_entities} tone="amber" />
                <MetricTile label="Cooldown Entities" value={metrics.trust_insights.cooldown_entities} tone="blue" />
              </div>
              <ul className="divide-y divide-zinc-100">
                {metrics.trust_insights.deposit_multiplier_distribution.map((bucket) => (
                  <li key={bucket.bucket} className="flex justify-between px-4 py-3 text-sm">
                    <span className="font-medium text-zinc-700">{bucket.bucket}</span>
                    <span className="font-semibold text-zinc-950">{displayValue(bucket.count)}</span>
                  </li>
                ))}
              </ul>
            </SectionPanel>

            <SectionPanel
              title="Governance Insights"
              icon={<ShieldCheck className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.governance_insights.source}
            >
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <MetricTile label="Reports Submitted" value={metrics.governance_insights.reports_submitted} />
                <MetricTile label="Reports Validated" value={metrics.governance_insights.reports_validated} tone="emerald" />
                <MetricTile label="Reports Dismissed" value={metrics.governance_insights.reports_dismissed} tone="amber" />
                <MetricTile label="Moderation Cases" value={metrics.governance_insights.moderation_cases} />
                <MetricTile label="Appeals Submitted" value={metrics.governance_insights.appeals_submitted} />
                <MetricTile label="Appeals Accepted" value={metrics.governance_insights.appeals_accepted} tone="blue" />
                <MetricTile label="Appeals Rejected" value={metrics.governance_insights.appeals_rejected} tone="rose" />
              </div>
            </SectionPanel>

            <SectionPanel
              title="Financial Insights"
              icon={<Database className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
              source={metrics.financial_insights.source}
            >
              <div className="grid gap-3 p-4 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <MetricTile label="Settlements Generated" value={metrics.financial_insights.settlements_generated} />
                <MetricTile label="Settlements Completed" value={metrics.financial_insights.settlements_completed} tone="emerald" />
                <MetricTile label="Refunds Processed" value={metrics.financial_insights.refunds_processed} tone="blue" />
              </div>
            </SectionPanel>
          </section>

          <SectionPanel
            title="Trend Analytics"
            icon={<LineChart className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            source={metrics.trend_analytics.source}
          >
            <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-5">
              <MetricTile label="Listings Created" value={trendTotals.listings} />
              <MetricTile label="Reservations" value={trendTotals.reservations} />
              <MetricTile label="Deliveries" value={trendTotals.deliveries} />
              <MetricTile label="Reports" value={trendTotals.reports} />
              <MetricTile label="Settlements" value={trendTotals.settlements} />
            </div>
            <TrendTable series={metrics.trend_analytics.series || []} />
          </SectionPanel>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-950">Metrics Lineage</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Generated {formatGovernanceDate(metrics.generated_at)} | {metrics.window.label}
                </p>
              </div>
              <p className="text-xs font-medium text-emerald-700">
                {metrics.informational_only ? "Informational only" : "State changing"}
              </p>
            </div>
            <div className="mt-4 grid gap-4 text-sm text-zinc-700 md:grid-cols-3">
              <div>
                <p className="font-semibold text-zinc-950">Reuse</p>
                <ul className="mt-2 space-y-2">
                  {metrics.analysis.reuse.slice(0, 4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-zinc-950">Gaps</p>
                <ul className="mt-2 space-y-2">
                  {metrics.analysis.gaps.slice(0, 4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-zinc-950">Risks</p>
                <ul className="mt-2 space-y-2">
                  {metrics.analysis.risks.slice(0, 4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}
