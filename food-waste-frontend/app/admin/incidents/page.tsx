"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
} from "lucide-react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import { adminService } from "@/services/admin.service";
import type {
  DbId,
  IncidentCategory,
  IncidentCenterData,
  IncidentDetailData,
  IncidentRow,
  IncidentSeverity,
  IncidentSourceType,
  IncidentStatus,
} from "@shared/contracts/api-contracts";

const STATUSES: IncidentStatus[] = [
  "OPEN",
  "INVESTIGATING",
  "IDENTIFIED",
  "MITIGATING",
  "RESOLVED",
  "CLOSED",
];

const SEVERITIES: IncidentSeverity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];

const CATEGORIES: IncidentCategory[] = [
  "INFRASTRUCTURE",
  "PAYMENTS",
  "TRUST",
  "GOVERNANCE",
  "NOTIFICATIONS",
  "REALTIME",
  "DATABASE",
  "SECURITY",
  "COMPLIANCE",
  "OTHER",
];

const SOURCE_TYPES: IncidentSourceType[] = [
  "manual",
  "operational_monitoring",
  "operational_alert",
  "queue_diagnostic",
  "trust_diagnostic",
  "financial_diagnostic",
];

const NEXT_STATUS: Record<string, IncidentStatus[]> = {
  OPEN: ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"],
  INVESTIGATING: ["IDENTIFIED", "MITIGATING", "RESOLVED"],
  IDENTIFIED: ["MITIGATING", "RESOLVED"],
  MITIGATING: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "border-blue-200 bg-blue-50 text-blue-700",
  INVESTIGATING: "border-amber-200 bg-amber-50 text-amber-800",
  IDENTIFIED: "border-purple-200 bg-purple-50 text-purple-700",
  MITIGATING: "border-orange-200 bg-orange-50 text-orange-700",
  RESOLVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CLOSED: "border-zinc-200 bg-zinc-100 text-zinc-700",
};

const SEVERITY_STYLES: Record<string, string> = {
  SEV1: "border-red-200 bg-red-50 text-red-700",
  SEV2: "border-orange-200 bg-orange-50 text-orange-700",
  SEV3: "border-amber-200 bg-amber-50 text-amber-800",
  SEV4: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function label(value: unknown) {
  return display(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function count(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatDuration(seconds: unknown) {
  const value = count(seconds);
  if (value <= 0) return "-";
  const hours = value / 3600;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function Badge({
  value,
  tone,
}: {
  value: unknown;
  tone?: Record<string, string>;
}) {
  const text = String(value || "");
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2.5 text-xs font-semibold ${
        tone?.[text] || "border-zinc-200 bg-zinc-50 text-zinc-700"
      }`}
    >
      {label(text)}
    </span>
  );
}

function sourceContextFromQuery(searchParams: {
  entries: () => IterableIterator<[string, string]>;
}) {
  const entries = Object.fromEntries(searchParams.entries());
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (key.startsWith("source_") || key.startsWith("monitoring_")) {
      context[key] = value;
    }
  }
  return context;
}

function IncidentList({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: IncidentRow[];
  selectedId?: DbId | null;
  onSelect: (id: DbId) => void;
}) {
  if (incidents.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No incidents match this view." />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
          <tr>
            <th className="px-4 py-3">Incident</th>
            <th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Assignee</th>
            <th className="px-4 py-3">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {incidents.map((incident) => {
            const active = String(selectedId || "") === String(incident.id);
            return (
              <tr
                key={String(incident.id)}
                className={`cursor-pointer text-zinc-700 ${
                  active ? "bg-zinc-50" : "hover:bg-zinc-50"
                }`}
                onClick={() => onSelect(incident.id)}
              >
                <td className="max-w-xs px-4 py-3">
                  <p className="truncate font-semibold text-zinc-950">{incident.title}</p>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {String(incident.id)}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <Badge value={incident.severity} tone={SEVERITY_STYLES} />
                </td>
                <td className="px-4 py-3">
                  <Badge value={incident.status} tone={STATUS_STYLES} />
                </td>
                <td className="px-4 py-3">{label(incident.category)}</td>
                <td className="px-4 py-3">{display(incident.assigned_admin_name || incident.assigned_admin_id)}</td>
                <td className="px-4 py-3">{formatGovernanceDate(incident.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ detail }: { detail: IncidentDetailData }) {
  return (
    <ol className="divide-y divide-zinc-100">
      {detail.timeline.map((event) => (
        <li key={String(event.id)} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-950">{label(event.event_type)}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {display(event.actor_name || event.actor_user_id)}
              </p>
            </div>
            <span className="text-xs text-zinc-500">
              {formatGovernanceDate(event.created_at)}
            </span>
          </div>
          {(event.from_status || event.to_status) && (
            <p className="mt-2 text-sm text-zinc-700">
              {display(event.from_status)} to {display(event.to_status)}
            </p>
          )}
          {(event.from_assigned_admin_id || event.to_assigned_admin_id) && (
            <p className="mt-2 text-sm text-zinc-700">
              {display(event.from_assigned_admin_name || event.from_assigned_admin_id)} to{" "}
              {display(event.to_assigned_admin_name || event.to_assigned_admin_id)}
            </p>
          )}
          {event.details && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
              {event.details}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function AdminIncidentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [incidentCenter, setIncidentCenter] = useState<IncidentCenterData | null>(null);
  const [selectedId, setSelectedId] = useState<DbId | null>(null);
  const [detail, setDetail] = useState<IncidentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [filters, setFilters] = useState({
    q: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
    severity: searchParams.get("severity") || "",
    category: searchParams.get("category") || "",
    assignedAdminId:
      searchParams.get("assignedAdminId") ||
      searchParams.get("assigned_admin_id") ||
      "",
  });

  const querySourceContext = useMemo(
    () => sourceContextFromQuery(searchParams),
    [searchParams]
  );

  const [createForm, setCreateForm] = useState({
    title: searchParams.get("title") || "",
    description: searchParams.get("description") || "",
    severity: (searchParams.get("severity") as IncidentSeverity) || "SEV3",
    category: (searchParams.get("category") as IncidentCategory) || "OTHER",
    assignedAdminId: "",
    sourceType:
      (searchParams.get("source_type") as IncidentSourceType) ||
      (searchParams.get("sourceType") as IncidentSourceType) ||
      "manual",
    sourceRefId:
      searchParams.get("source_ref_id") || searchParams.get("sourceRefId") || "",
  });
  const [statusForm, setStatusForm] = useState({ status: "", note: "" });
  const [assignmentForm, setAssignmentForm] = useState({
    assignedAdminId: "",
    note: "",
  });
  const [noteText, setNoteText] = useState("");
  const [postmortem, setPostmortem] = useState({
    rootCause: "",
    impactSummary: "",
    detectionMethod: "",
    resolutionSummary: "",
    followUpActions: "",
  });

  const loadIncidents = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await adminService.getIncidents({
        q: filters.q || undefined,
        status: filters.status || undefined,
        severity: filters.severity || undefined,
        category: filters.category || undefined,
        assignedAdminId: filters.assignedAdminId || undefined,
      });
      setIncidentCenter(data);
      const firstId = data.incidents[0]?.id || null;
      setSelectedId((current) => current || firstId);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadDetail = useCallback(async (id: DbId | null) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      setDetailLoading(true);
      setError("");
      const data = await adminService.getIncident(id);
      setDetail(data);
      setAssignmentForm({
        assignedAdminId: data.incident.assigned_admin_id
          ? String(data.incident.assigned_admin_id)
          : "",
        note: "",
      });
      const options = NEXT_STATUS[String(data.incident.status)] || [];
      setStatusForm({ status: options[0] || "", note: "" });
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadIncidents();
    });
    return () => {
      active = false;
    };
  }, [loadIncidents]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadDetail(selectedId);
    });
    return () => {
      active = false;
    };
  }, [loadDetail, selectedId]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `/admin/incidents?${query}` : "/admin/incidents");
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSubmitting("create");
      setError("");
      setSuccess("");
      const created = await adminService.createIncident({
        title: createForm.title,
        description: createForm.description,
        severity: createForm.severity,
        category: createForm.category,
        assignedAdminId: createForm.assignedAdminId || null,
        sourceType: createForm.sourceType,
        sourceRefId: createForm.sourceRefId || null,
        sourceContext: querySourceContext,
      });
      setSuccess("Incident created.");
      setCreateForm((current) => ({ ...current, title: "", description: "" }));
      setSelectedId(created.incident.id);
      await loadIncidents();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  async function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !statusForm.status) return;
    try {
      setSubmitting("status");
      setError("");
      const updated = await adminService.updateIncidentStatus(detail.incident.id, {
        status: statusForm.status,
        note: statusForm.note,
      });
      setSuccess("Incident status updated.");
      setDetail(updated);
      const options = NEXT_STATUS[String(updated.incident.status)] || [];
      setStatusForm({ status: options[0] || "", note: "" });
      await loadIncidents();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    try {
      setSubmitting("assignment");
      setError("");
      const updated = await adminService.assignIncident(detail.incident.id, {
        assignedAdminId: assignmentForm.assignedAdminId || null,
        note: assignmentForm.note,
      });
      setSuccess("Incident assignment updated.");
      setDetail(updated);
      await loadIncidents();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    try {
      setSubmitting("note");
      setError("");
      const updated = await adminService.addIncidentNote(detail.incident.id, {
        note: noteText,
      });
      setSuccess("Incident note added.");
      setNoteText("");
      setDetail(updated);
      await loadIncidents();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  async function submitPostmortem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    try {
      setSubmitting("postmortem");
      setError("");
      const updated = await adminService.addIncidentPostmortem(
        detail.incident.id,
        postmortem
      );
      setSuccess("Postmortem recorded.");
      setPostmortem({
        rootCause: "",
        impactSummary: "",
        detectionMethod: "",
        resolutionSummary: "",
        followUpActions: "",
      });
      setDetail(updated);
      await loadIncidents();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  const summary = incidentCenter?.summary;
  const reporting = incidentCenter?.reporting;
  const current = detail?.incident;
  const statusOptions = current ? NEXT_STATUS[String(current.status)] || [] : [];
  const canPostmortem =
    current &&
    ["RESOLVED", "CLOSED"].includes(String(current.status)) &&
    !detail?.postmortem;

  return (
    <AdminShell
      title="Incident Management"
      description="Operational response records, assignment, resolution, and postmortems."
    >
      {error && <AdminStateBlock title={error} tone="error" />}
      {success && <AdminStateBlock title={success} />}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <AdminMetricCard
          label="Open Incidents"
          value={display(summary?.open_incidents)}
          detail="Active response"
        />
        <AdminMetricCard
          label="Critical"
          value={display(summary?.critical_incidents)}
          detail="SEV1 open"
        />
        <AdminMetricCard
          label="Resolved"
          value={display(summary?.recently_resolved_incidents)}
          detail="Last 7 days"
        />
        <AdminMetricCard
          label="Assigned"
          value={display(summary?.assigned_to_me)}
          detail="Assigned to you"
        />
        <AdminMetricCard
          label="MTTR"
          value={formatDuration(reporting?.mttr_seconds)}
          detail={`${display(reporting?.resolved_count)} resolved`}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <form
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"
              onSubmit={applyFilters}
            >
              <label className="block text-sm xl:col-span-2">
                <span className="font-medium text-zinc-700">Search</span>
                <input
                  value={filters.q}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, q: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  placeholder="Incident ID, title, reference"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Status</span>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, status: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  <option value="">All</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {label(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Severity</span>
                <select
                  value={filters.severity}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, severity: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  <option value="">All</option>
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Category</span>
                <select
                  value={filters.category}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, category: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  <option value="">All</option>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {label(category)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => void loadIncidents()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                  title="Refresh"
                  aria-label="Refresh incidents"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </form>
          </section>

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <ClipboardList className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              <h2 className="text-base font-semibold text-zinc-950">Incidents</h2>
            </div>
            {loading && !incidentCenter ? (
              <div className="p-4">
                <AdminStateBlock title="Loading incidents..." />
              </div>
            ) : (
              <IncidentList
                incidents={incidentCenter?.incidents || []}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-950">Severity</h2>
              <div className="mt-3 grid gap-2">
                {(reporting?.by_severity || []).map((item) => (
                  <div
                    key={String(item.severity)}
                    className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm"
                  >
                    <Badge value={item.severity} tone={SEVERITY_STYLES} />
                    <span className="font-semibold text-zinc-950">{display(item.count)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-950">Category</h2>
              <div className="mt-3 grid gap-2">
                {(reporting?.by_category || []).slice(0, 8).map((item) => (
                  <div
                    key={String(item.category)}
                    className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-zinc-700">
                      {label(item.category)}
                    </span>
                    <span className="font-semibold text-zinc-950">{display(item.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <form
          className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
          onSubmit={submitCreate}
        >
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-zinc-600" aria-hidden="true" />
            <h2 className="text-base font-semibold text-zinc-950">Create Incident</h2>
          </div>
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="font-medium text-zinc-700">Title</span>
              <input
                value={createForm.title}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, title: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-zinc-700">Description</span>
              <textarea
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="mt-1 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Severity</span>
                <select
                  value={createForm.severity}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      severity: event.target.value as IncidentSeverity,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Category</span>
                <select
                  value={createForm.category}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      category: event.target.value as IncidentCategory,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {label(category)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-zinc-700">Assigned admin id</span>
              <input
                value={createForm.assignedAdminId}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    assignedAdminId: event.target.value,
                  }))
                }
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                placeholder="Optional UUID"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Source</span>
                <select
                  value={createForm.sourceType}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      sourceType: event.target.value as IncidentSourceType,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                >
                  {SOURCE_TYPES.map((source) => (
                    <option key={source} value={source}>
                      {label(source)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Reference ID</span>
                <input
                  value={createForm.sourceRefId}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      sourceRefId: event.target.value,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={submitting === "create"}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {submitting === "create" ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </section>

      {current && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <div className="space-y-4">
            <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    {String(current.id)}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-950">
                    {current.title}
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                    {display(current.description)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Badge value={current.severity} tone={SEVERITY_STYLES} />
                  <Badge value={current.status} tone={STATUS_STYLES} />
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">Category</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">{label(current.category)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">Assignee</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {display(current.assigned_admin_name || current.assigned_admin_id)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">Created</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatGovernanceDate(current.created_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">Source</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {label(current.source_type)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/admin/audit-center?domains=incidents&q=${encodeURIComponent(String(current.id))}`}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                  Audit Trail
                </Link>
                {current.source_ref_id && (
                  <span className="inline-flex items-center rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700">
                    Ref {current.source_ref_id}
                  </span>
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
                <History className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-950">Timeline</h2>
              </div>
              {detailLoading ? (
                <div className="p-4">
                  <AdminStateBlock title="Loading incident timeline..." />
                </div>
              ) : detail ? (
                <Timeline detail={detail} />
              ) : (
                <div className="p-4">
                  <AdminStateBlock title="Select an incident." />
                </div>
              )}
            </section>

            {detail?.postmortem && (
              <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-zinc-950">Postmortem</h2>
                </div>
                <dl className="mt-4 grid gap-3 text-sm lg:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium uppercase text-zinc-500">Root Cause</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-zinc-700">
                      {detail.postmortem.root_cause}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase text-zinc-500">Impact</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-zinc-700">
                      {detail.postmortem.impact_summary}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase text-zinc-500">Detection</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-zinc-700">
                      {detail.postmortem.detection_method}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase text-zinc-500">Resolution</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-zinc-700">
                      {detail.postmortem.resolution_summary}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
                  {detail.postmortem.follow_up_actions}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-4">
            <form
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              onSubmit={submitStatus}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-950">Status</h2>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="font-medium text-zinc-700">Next status</span>
                  <select
                    value={statusForm.status}
                    onChange={(event) =>
                      setStatusForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    disabled={statusOptions.length === 0}
                    className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-50"
                  >
                    {statusOptions.length === 0 ? (
                      <option value="">No transition</option>
                    ) : (
                      statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {label(status)}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-zinc-700">Note</span>
                  <textarea
                    value={statusForm.note}
                    onChange={(event) =>
                      setStatusForm((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    className="mt-1 min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  />
                </label>
                <button
                  type="submit"
                  disabled={submitting === "status" || statusOptions.length === 0}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  {submitting === "status" ? "Updating..." : "Update Status"}
                </button>
              </div>
            </form>

            <form
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              onSubmit={submitAssignment}
            >
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-950">Assignment</h2>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="font-medium text-zinc-700">Assigned admin id</span>
                  <input
                    value={assignmentForm.assignedAdminId}
                    onChange={(event) =>
                      setAssignmentForm((current) => ({
                        ...current,
                        assignedAdminId: event.target.value,
                      }))
                    }
                    className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-zinc-700">Note</span>
                  <textarea
                    value={assignmentForm.note}
                    onChange={(event) =>
                      setAssignmentForm((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    className="mt-1 min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  />
                </label>
                <button
                  type="submit"
                  disabled={submitting === "assignment" || current.status === "CLOSED"}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  {submitting === "assignment" ? "Saving..." : "Save Assignment"}
                </button>
              </div>
            </form>

            <form
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              onSubmit={submitNote}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-950">Note</h2>
              </div>
              <div className="mt-4 space-y-3">
                <textarea
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  className="min-h-28 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  required
                />
                <button
                  type="submit"
                  disabled={submitting === "note"}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  {submitting === "note" ? "Adding..." : "Add Note"}
                </button>
              </div>
            </form>

            {canPostmortem && (
              <form
                className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
                onSubmit={submitPostmortem}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-zinc-950">Postmortem</h2>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    ["rootCause", "Root cause"],
                    ["impactSummary", "Impact summary"],
                    ["detectionMethod", "Detection method"],
                    ["resolutionSummary", "Resolution summary"],
                    ["followUpActions", "Follow-up actions"],
                  ].map(([key, title]) => (
                    <label key={key} className="block text-sm">
                      <span className="font-medium text-zinc-700">{title}</span>
                      <textarea
                        value={postmortem[key as keyof typeof postmortem]}
                        onChange={(event) =>
                          setPostmortem((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        className="mt-1 min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                        required
                      />
                    </label>
                  ))}
                  <button
                    type="submit"
                    disabled={submitting === "postmortem"}
                    className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {submitting === "postmortem" ? "Recording..." : "Record Postmortem"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      )}
    </AdminShell>
  );
}
