"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FileJson,
  Filter,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminAuditCenter,
  type AuditCenterParams,
} from "@/services/admin.service";
import type {
  AuditCenterEvent,
  AuditCenterSourceInventory,
} from "@shared/contracts/api-contracts";

const DOMAIN_OPTIONS = [
  "trust",
  "moderation",
  "appeals",
  "verification",
  "governance",
  "incidents",
  "financial",
  "notifications",
  "compliance",
];

const ACTOR_OPTIONS = ["all", "user", "provider", "ngo", "volunteer", "admin"];
const LIMIT_OPTIONS = [25, 50, 100];

const DOMAIN_STYLES: Record<string, string> = {
  trust: "border-emerald-200 bg-emerald-50 text-emerald-700",
  moderation: "border-amber-200 bg-amber-50 text-amber-800",
  appeals: "border-blue-200 bg-blue-50 text-blue-700",
  verification: "border-cyan-200 bg-cyan-50 text-cyan-700",
  governance: "border-violet-200 bg-violet-50 text-violet-700",
  financial: "border-zinc-300 bg-zinc-100 text-zinc-800",
  notifications: "border-rose-200 bg-rose-50 text-rose-700",
  compliance: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

type AuditFilters = {
  domains: string[];
  actorType: string;
  actorId: string;
  q: string;
  limit: number;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function label(value: unknown) {
  return displayValue(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseDomains(value: string | null) {
  const domains = String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => DOMAIN_OPTIONS.includes(item));
  return domains.length ? domains : DOMAIN_OPTIONS;
}

function filtersFromParams(searchParams: URLSearchParams): AuditFilters {
  const actorType = searchParams.get("actorType") || searchParams.get("actor_type") || "all";
  const limit = Number(searchParams.get("limit") || 50);

  return {
    domains: parseDomains(searchParams.get("domains") || searchParams.get("domain")),
    actorType: ACTOR_OPTIONS.includes(actorType) ? actorType : "all",
    actorId: searchParams.get("actorId") || searchParams.get("actor_id") || "",
    q: searchParams.get("q") || searchParams.get("search") || "",
    limit: LIMIT_OPTIONS.includes(limit) ? limit : 50,
  };
}

function paramsFromFilters(filters: AuditFilters, cursor?: string | null): AuditCenterParams {
  const params: AuditCenterParams = {
    limit: filters.limit,
  };

  if (filters.domains.length !== DOMAIN_OPTIONS.length) {
    params.domains = filters.domains.join(",");
  }
  if (filters.actorType !== "all") params.actorType = filters.actorType;
  if (filters.actorId.trim()) params.actorId = filters.actorId.trim();
  if (filters.q.trim()) params.q = filters.q.trim();
  if (cursor) params.cursor = cursor;

  return params;
}

function queryFromFilters(filters: AuditFilters) {
  const params = new URLSearchParams();
  if (filters.domains.length !== DOMAIN_OPTIONS.length) {
    params.set("domains", filters.domains.join(","));
  }
  if (filters.actorType !== "all") params.set("actorType", filters.actorType);
  if (filters.actorId.trim()) params.set("actorId", filters.actorId.trim());
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.limit !== 50) params.set("limit", String(filters.limit));
  return params.toString();
}

function sourceText(event: AuditCenterEvent) {
  return [
    event.source?.table,
    event.source?.event_identifier,
    event.source?.record_identifier,
  ]
    .filter(Boolean)
    .join(" | ");
}

function domainTone(domain: unknown) {
  return DOMAIN_STYLES[String(domain)] || "border-zinc-200 bg-zinc-50 text-zinc-700";
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

function DomainToggle({
  domain,
  selected,
  onToggle,
}: {
  domain: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
        selected
          ? "border-zinc-950 bg-zinc-950 text-white"
          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
      }`}
    >
      {label(domain)}
    </button>
  );
}

function EventList({
  events,
  selected,
  onSelect,
}: {
  events: AuditCenterEvent[];
  selected: AuditCenterEvent | null;
  onSelect: (event: AuditCenterEvent) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No audit events match these filters." />
      </div>
    );
  }

  return (
    <ol className="divide-y divide-zinc-100">
      {events.map((event, index) => {
        const active =
          selected?.source?.record_identifier === event.source?.record_identifier &&
          selected?.timestamp === event.timestamp;

        return (
          <li key={`${event.source?.record_identifier}-${event.timestamp}-${index}`}>
            <button
              type="button"
              onClick={() => onSelect(event)}
              className={`block w-full px-4 py-3 text-left transition ${
                active ? "bg-zinc-100" : "bg-white hover:bg-zinc-50"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-semibold ${domainTone(
                        event.domain
                      )}`}
                    >
                      {label(event.domain)}
                    </span>
                    <p className="truncate text-sm font-semibold text-zinc-950">
                      {label(event.action)}
                    </p>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-600">
                    {displayValue(event.details)}
                  </p>
                  <p className="mt-2 truncate text-xs text-zinc-500">
                    {displayValue(event.actor?.label || event.actor?.id || event.actor?.type)}{" "}
                    <ChevronRight className="inline h-3 w-3" aria-hidden="true" />
                    {displayValue(event.target?.label || event.target?.id || event.target?.type)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatGovernanceDate(event.timestamp)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function EventDetails({ event }: { event: AuditCenterEvent | null }) {
  if (!event) {
    return <AdminStateBlock title="Select an audit event." />;
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Audit Details
            </p>
            <h2 className="mt-1 text-base font-semibold text-zinc-950">
              {label(event.action)}
            </h2>
          </div>
          <Link
            href={event.href || "/admin/audit-center"}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open Source
          </Link>
        </div>
      </div>

      <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Timestamp</dt>
          <dd className="mt-1 font-semibold text-zinc-950">
            {formatGovernanceDate(event.timestamp)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Domain</dt>
          <dd className="mt-1 font-semibold text-zinc-950">{label(event.domain)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Actor</dt>
          <dd className="mt-1 font-semibold text-zinc-950">
            {displayValue(event.actor?.label || event.actor?.id)}
          </dd>
          <dd className="text-xs text-zinc-500">{label(event.actor?.type)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Target</dt>
          <dd className="mt-1 font-semibold text-zinc-950">
            {displayValue(event.target?.label || event.target?.id)}
          </dd>
          <dd className="text-xs text-zinc-500">{label(event.target?.type)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Event Type</dt>
          <dd className="mt-1 font-semibold text-zinc-950">
            {displayValue(event.event_type)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Source</dt>
          <dd className="mt-1 font-semibold text-zinc-950">
            {displayValue(event.source?.table)}
          </dd>
          <dd className="text-xs text-zinc-500">
            {event.source?.immutable ? "Immutable source" : "Mutable owning record"}
          </dd>
        </div>
      </dl>

      <div className="border-t border-zinc-100 p-4">
        <p className="text-xs font-medium uppercase text-zinc-500">Lineage</p>
        <div className="mt-2 space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
          <p>Event Source: {displayValue(event.source?.table)}</p>
          <p>Event Identifier: {displayValue(event.source?.event_identifier)}</p>
          <p>Record Identifier: {displayValue(event.source?.record_identifier)}</p>
        </div>
      </div>

      <div className="border-t border-zinc-100 p-4">
        <p className="text-xs font-medium uppercase text-zinc-500">Details</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
          {displayValue(event.details)}
        </p>
      </div>

      <div className="border-t border-zinc-100 p-4">
        <p className="text-xs font-medium uppercase text-zinc-500">Supporting Metadata</p>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-950 p-3 text-xs leading-5 text-zinc-50">
          {JSON.stringify(event.metadata || {}, null, 2)}
        </pre>
      </div>
    </section>
  );
}

function SourceInventory({ sources }: { sources: AuditCenterSourceInventory[] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <Database className="h-4 w-4 text-zinc-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-zinc-950">Reusable Sources</h2>
      </div>
      <ul className="divide-y divide-zinc-100">
        {sources.map((source) => (
          <li key={`${source.domain}-${source.source}`} className="px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-950">
                  {source.source}
                </p>
                <p className="mt-1 text-xs text-zinc-600">{source.reuse}</p>
              </div>
              <span className="w-fit rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                {label(source.status)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AuditCenterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(
    () => filtersFromParams(searchParams),
    [searchParams]
  );
  const [draft, setDraft] = useState<AuditFilters>(filters);
  const [audit, setAudit] = useState<AdminAuditCenter | null>(null);
  const [events, setEvents] = useState<AuditCenterEvent[]>([]);
  const [selected, setSelected] = useState<AuditCenterEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setDraft(filters);
    });
    return () => {
      active = false;
    };
  }, [filters]);

  const loadAudit = useCallback(
    async (cursor?: string | null, append = false) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          setSelected(null);
        }
        setError("");
        const result = await adminService.getAuditCenter(
          paramsFromFilters(filters, cursor)
        );
        setAudit(result);
        setEvents((current) => {
          const next = append ? [...current, ...result.events] : result.events;
          if (!append) setSelected(next[0] || null);
          return next;
        });
      } catch (err) {
        setError(adminService.getErrorMessage(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(async () => {
      if (!active) return;
      await loadAudit(null, false);
    });
    return () => {
      active = false;
    };
  }, [loadAudit]);

  const applyFilters = () => {
    const query = queryFromFilters(draft);
    router.push(query ? `/admin/audit-center?${query}` : "/admin/audit-center");
  };

  const toggleDomain = (domain: string) => {
    setDraft((current) => {
      const selected = current.domains.includes(domain);
      const nextDomains = selected
        ? current.domains.filter((item) => item !== domain)
        : [...current.domains, domain];
      return {
        ...current,
        domains: nextDomains.length ? nextDomains : DOMAIN_OPTIONS,
      };
    });
  };

  const selectAllDomains = () => {
    setDraft((current) => ({ ...current, domains: DOMAIN_OPTIONS }));
  };

  const exportCurrent = async (format: "csv" | "json") => {
    try {
      setExporting(format);
      setError("");
      const result = await adminService.exportAuditCenter(
        format,
        paramsFromFilters(filters)
      );
      downloadBlob(result.blob, result.filename);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <AdminShell
      title="Audit Center"
      description="Centralized, read-only investigation timeline across trust, moderation, appeals, verification, governance, incidents, financial, notification, and compliance records."
    >
      {error && <AdminStateBlock title={error} tone="error" />}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-zinc-600" aria-hidden="true" />
          <h2 className="text-base font-semibold text-zinc-950">Filters</h2>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAllDomains}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
              draft.domains.length === DOMAIN_OPTIONS.length
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            All
          </button>
          {DOMAIN_OPTIONS.map((domain) => (
            <DomainToggle
              key={domain}
              domain={domain}
              selected={draft.domains.includes(domain)}
              onToggle={() => toggleDomain(domain)}
            />
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_110px_auto]">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Actor</span>
            <select
              value={draft.actorType}
              onChange={(event) =>
                setDraft((current) => ({ ...current, actorType: event.target.value }))
              }
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            >
              {ACTOR_OPTIONS.map((actor) => (
                <option key={actor} value={actor}>
                  {label(actor)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Entity id</span>
            <input
              value={draft.actorId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, actorId: event.target.value }))
              }
              placeholder="User, subject, case, appeal, payment, or source id"
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Search</span>
            <input
              value={draft.q}
              onChange={(event) =>
                setDraft((current) => ({ ...current, q: event.target.value }))
              }
              placeholder="Case, appeal, trust event, subject, order"
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Rows</span>
            <select
              value={draft.limit}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  limit: Number(event.target.value),
                }))
              }
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            >
              {LIMIT_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Apply
            </button>
            <button
              type="button"
              onClick={() => void loadAudit(null, false)}
              disabled={loading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
              title="Refresh"
              aria-label="Refresh audit timeline"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              <h2 className="text-base font-semibold text-zinc-950">
                Global Timeline
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void exportCurrent("csv")}
                disabled={exporting !== null}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => void exportCurrent("json")}
                disabled={exporting !== null}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                <FileJson className="h-4 w-4" aria-hidden="true" />
                JSON
              </button>
            </div>
          </div>
          {loading ? (
            <div className="p-4">
              <AdminStateBlock title="Loading audit timeline..." />
            </div>
          ) : (
            <>
              <EventList
                events={events}
                selected={selected}
                onSelect={(event) => setSelected(event)}
              />
              {audit?.pagination?.has_more && (
                <div className="border-t border-zinc-200 p-4">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() =>
                      void loadAudit(audit.pagination.next_cursor || null, true)
                    }
                    className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${loadingMore ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    {loadingMore ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <EventDetails event={selected} />

          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <ShieldCheck className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              <h2 className="text-base font-semibold text-zinc-950">
                Recent Admin Actions
              </h2>
            </div>
            {audit?.recent_admin_actions?.length ? (
              <ul className="divide-y divide-zinc-100">
                {audit.recent_admin_actions.map((event, index) => (
                  <li
                    key={`${event.source?.record_identifier}-${index}`}
                    className="px-4 py-3"
                  >
                    <Link
                      href={event.href}
                      className="text-sm font-semibold text-zinc-950 hover:underline"
                    >
                      {label(event.action)}
                    </Link>
                    <p className="mt-1 text-xs text-zinc-500">
                      {displayValue(event.actor?.label || event.actor?.id)} |{" "}
                      {formatGovernanceDate(event.timestamp)}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-600">
                      {sourceText(event)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4">
                <AdminStateBlock title="No recent admin actions in this view." />
              </div>
            )}
          </section>
        </div>
      </section>

      {audit && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <SourceInventory sources={audit.source_inventory || []} />

          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Architecture Notes
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Generated {formatGovernanceDate(audit.generated_at)}
              </p>
            </div>
            <div className="grid gap-4 p-4 text-sm text-zinc-700 md:grid-cols-2">
              <div>
                <p className="font-semibold text-zinc-950">Gaps</p>
                <ul className="mt-2 space-y-2">
                  {audit.analysis.gaps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-zinc-950">Risks</p>
                <ul className="mt-2 space-y-2">
                  {audit.analysis.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </section>
      )}
    </AdminShell>
  );
}
