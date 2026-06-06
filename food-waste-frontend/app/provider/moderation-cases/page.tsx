"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  FileText,
  MessageSquare,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { providerModerationService } from "@/services/providerModeration.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { ProviderModerationCaseSummary } from "@shared/contracts/api-contracts";

const ACTIVE_STATUSES = new Set(["OPEN", "UNDER_REVIEW", "AWAITING_RESPONSE", "ESCALATED"]);

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function displayLabel(value: unknown) {
  return displayValue(value).replace(/_/g, " ");
}

function formatDate(value: string | undefined | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusBadge(status: unknown) {
  const value = String(status || "OPEN").toUpperCase();
  if (value === "VALIDATED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "DISMISSED") return "border-zinc-200 bg-zinc-100 text-zinc-700";
  if (value === "ESCALATED") return "border-red-200 bg-red-50 text-red-700";
  if (value === "AWAITING_RESPONSE") return "border-amber-200 bg-amber-50 text-amber-800";
  if (value === "UNDER_REVIEW") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-zinc-200 bg-white text-zinc-700";
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Clock3;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
          <p className="mt-1 text-sm text-zinc-600">{detail}</p>
        </div>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-50 text-zinc-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </article>
  );
}

function caseNeedsResponse(item: ProviderModerationCaseSummary) {
  return (
    String(item.status).toUpperCase() === "AWAITING_RESPONSE" &&
    !item.provider_response_id
  );
}

export default function ProviderModerationCasesPage() {
  const moderationCaseVersion = useRealtimeStore(
    (state) => state.moderationCaseVersion
  );
  const [cases, setCases] = useState<ProviderModerationCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCases = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      setError("");
      const result = await providerModerationService.getProviderModerationCases();
      setCases(result);
    } catch (err) {
      setError(providerModerationService.getErrorMessage(err));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadCases(true);
    });
  }, [loadCases]);

  useEffect(() => {
    if (!moderationCaseVersion) return;
    queueMicrotask(() => {
      void loadCases(false);
    });
  }, [loadCases, moderationCaseVersion]);

  const stats = useMemo(
    () => ({
      active: cases.filter((item) => ACTIVE_STATUSES.has(String(item.status).toUpperCase())).length,
      awaiting: cases.filter(caseNeedsResponse).length,
      responded: cases.filter((item) => item.provider_response_id).length,
      appealed: cases.filter((item) => item.appeal_id).length,
      closed: cases.filter((item) => !ACTIVE_STATUSES.has(String(item.status).toUpperCase())).length,
    }),
    [cases]
  );

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <Link
              href="/provider/listings"
              className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-950"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Provider listings
            </Link>
            <h1 className="mt-3 text-2xl font-semibold text-zinc-950">
              Moderation Cases
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Review report context and provider response history.
            </p>
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {!loading && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Active"
              value={stats.active}
              detail="Open case records"
              icon={ShieldAlert}
            />
            <StatCard
              label="Awaiting"
              value={stats.awaiting}
              detail="Responses pending"
              icon={MessageSquare}
            />
            <StatCard
              label="Responded"
              value={stats.responded}
              detail="Response records"
              icon={FileText}
            />
            <StatCard
              label="Appealed"
              value={stats.appealed}
              detail="Formal appeals"
              icon={Scale}
            />
            <StatCard
              label="Closed"
              value={stats.closed}
              detail="Final decisions"
              icon={Clock3}
            />
          </section>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading moderation cases...
          </div>
        ) : cases.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No moderation cases found.
          </div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {cases.map((item) => {
              const needsResponse = caseNeedsResponse(item);
              const responseAttachmentCount = Number(
                item.provider_response_attachment_count || 0
              );
              const appealAttachmentCount = Number(item.appeal_attachment_count || 0);

              return (
                <article
                  key={String(item.id)}
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
                >
                  <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        {displayLabel(item.report_reason || item.reason)}
                      </p>
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusBadge(
                          item.status
                        )}`}
                      >
                        {displayLabel(item.status)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                          needsResponse
                            ? "bg-amber-50 text-amber-800"
                            : "bg-zinc-50 text-zinc-700"
                        }`}
                      >
                        {needsResponse ? (
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-zinc-950">
                          {displayValue(item.listing_title || item.summary)}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-sm text-zinc-600">
                          {displayValue(item.summary)}
                        </p>
                      </div>
                    </div>

                    <dl className="grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-medium uppercase text-zinc-500">
                          Report
                        </dt>
                        <dd className="mt-1 text-zinc-950">
                          {displayLabel(item.report_status)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase text-zinc-500">
                          Updated
                        </dt>
                        <dd className="mt-1 text-zinc-950">
                          {formatDate(item.updated_at)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase text-zinc-500">
                          Evidence
                        </dt>
                        <dd className="mt-1 text-zinc-950">
                          {responseAttachmentCount} response image
                          {responseAttachmentCount === 1 ? "" : "s"}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-4">
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                          item.provider_response_id
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-zinc-200 bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {item.provider_response_id ? "Response submitted" : "No response"}
                      </span>
                      {item.appeal_id && (
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                          Appeal {displayLabel(item.appeal_status)}
                          {appealAttachmentCount > 0
                            ? ` (${appealAttachmentCount})`
                            : ""}
                        </span>
                      )}
                      <Link
                        href={`/provider/moderation-cases/${String(item.id)}`}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
                      >
                        <FileText className="h-4 w-4" aria-hidden="true" />
                        Open
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
