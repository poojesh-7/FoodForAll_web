"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  History,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserX,
} from "lucide-react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import { adminService } from "@/services/admin.service";
import type {
  ComplianceDashboardData,
  ComplianceEvidenceRow,
  ComplianceRequestType,
  ComplianceSubjectType,
  DataDeletionRequestRow,
  DbId,
  RetentionPolicyRow,
} from "@shared/contracts/api-contracts";

const REQUEST_TYPES: ComplianceRequestType[] = [
  "account_deletion",
  "data_access",
  "anonymization",
  "evidence_deletion",
  "notification_cleanup",
];

const SUBJECT_TYPES: ComplianceSubjectType[] = [
  "user",
  "provider",
  "ngo",
  "volunteer",
  "provider_report_attachment",
  "moderation_appeal_attachment",
  "notification",
  "other",
];

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: "border-blue-200 bg-blue-50 text-blue-700",
  UNDER_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
  EXECUTED: "border-zinc-300 bg-zinc-100 text-zinc-700",
  CANCELLED: "border-zinc-200 bg-zinc-50 text-zinc-600",
};

function display(value: unknown) {
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
  return display(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function complianceExecutionLines(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object") return [];
  const mode = metadata.mode;
  if (mode !== "account_deletion" && mode !== "anonymization") return [];

  const preserved = Array.isArray(metadata.preserved) ? metadata.preserved : [];
  const lines = [`Mode: ${label(mode)}`];
  if (metadata.identity_anonymized === true || metadata.user_contact_fields_anonymized === true) {
    lines.push("Identity anonymized");
  }
  if (metadata.account_access_revoked === true) {
    lines.push("Account access revoked");
  }
  if (
    preserved.some((item) =>
      [
        "financial_records",
        "trust_replay_records",
        "audit_records",
        "moderation_history",
        "incident_history",
      ].includes(String(item))
    )
  ) {
    lines.push("Legal retention records preserved");
  }
  return lines;
}

function formatBytes(value: unknown) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function Badge({ value }: { value: unknown }) {
  const text = String(value || "");
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2.5 text-xs font-semibold ${
        STATUS_STYLES[text] || "border-zinc-200 bg-zinc-50 text-zinc-700"
      }`}
    >
      {label(text)}
    </span>
  );
}

function SectionPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        {icon}
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function PolicyTable({ policies }: { policies: RetentionPolicyRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Policy</th>
            <th className="px-4 py-3 font-semibold">Retention</th>
            <th className="px-4 py-3 font-semibold">Archive</th>
            <th className="px-4 py-3 font-semibold">Deletion</th>
            <th className="px-4 py-3 font-semibold">Protection</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {policies.map((policy) => (
            <tr key={policy.policy_key}>
              <td className="max-w-sm px-4 py-3">
                <p className="font-semibold text-zinc-950">{policy.display_name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                  {policy.description}
                </p>
              </td>
              <td className="px-4 py-3">
                {policy.retention_duration_days ? `${display(policy.retention_duration_days)}d` : "Indefinite"}
              </td>
              <td className="px-4 py-3">
                {policy.archive_after_days ? `${display(policy.archive_after_days)}d` : label(policy.archive_mode)}
              </td>
              <td className="px-4 py-3">
                {policy.deletion_eligible ? label(policy.deletion_mode) : "Never by default"}
              </td>
              <td className="px-4 py-3 text-xs text-zinc-600">
                {[
                  policy.protects_financial_integrity ? "Financial" : null,
                  policy.protects_trust_replay ? "Trust" : null,
                  policy.protects_investigations ? "Investigations" : null,
                  policy.searchable_when_archived ? "Searchable" : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestList({
  requests,
  selectedId,
  onSelect,
}: {
  requests: DataDeletionRequestRow[];
  selectedId?: DbId | null;
  onSelect: (request: DataDeletionRequestRow) => void;
}) {
  if (!requests.length) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No compliance requests in this view." />
      </div>
    );
  }

  return (
    <ol className="divide-y divide-zinc-100">
      {requests.map((request) => {
        const active = String(selectedId || "") === String(request.id);
        return (
          <li key={String(request.id)}>
            <button
              type="button"
              onClick={() => onSelect(request)}
              className={`block w-full px-4 py-3 text-left transition ${
                active ? "bg-zinc-100" : "hover:bg-zinc-50"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge value={request.status} />
                    <p className="truncate text-sm font-semibold text-zinc-950">
                      {label(request.request_type)}
                    </p>
                  </div>
                  <p className="mt-2 truncate text-xs text-zinc-500">
                    {label(request.subject_type)} | {String(request.subject_id)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-600">
                    {request.reason}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatGovernanceDate(request.requested_at)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function EvidenceTable({
  evidence,
  onArchive,
  submitting,
}: {
  evidence: ComplianceEvidenceRow[];
  onArchive: (row: ComplianceEvidenceRow) => void;
  submitting: string;
}) {
  if (!evidence.length) {
    return <AdminStateBlock title="No evidence records found." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Evidence</th>
            <th className="px-4 py-3 font-semibold">Size</th>
            <th className="px-4 py-3 font-semibold">Archive</th>
            <th className="px-4 py-3 font-semibold">Created</th>
            <th className="px-4 py-3 font-semibold">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {evidence.map((row) => (
            <tr key={`${row.evidence_type}-${row.id}`}>
              <td className="max-w-sm px-4 py-3">
                <p className="font-semibold text-zinc-950">{label(row.evidence_type)}</p>
                <p className="mt-1 truncate text-xs text-zinc-500">{String(row.id)}</p>
              </td>
              <td className="px-4 py-3">{formatBytes(row.file_size_bytes)}</td>
              <td className="px-4 py-3">{label(row.archive_status)}</td>
              <td className="px-4 py-3">{formatGovernanceDate(row.created_at)}</td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => onArchive(row)}
                  disabled={String(row.archive_status) === "archived" || submitting === String(row.id)}
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50"
                >
                  {submitting === String(row.id) ? "Saving..." : "Archive"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminCompliancePage() {
  const [compliance, setCompliance] = useState<ComplianceDashboardData | null>(null);
  const [selected, setSelected] = useState<DataDeletionRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [note, setNote] = useState("");
  const [form, setForm] = useState({
    requestType: "account_deletion" as ComplianceRequestType,
    subjectType: "user" as ComplianceSubjectType,
    subjectId: "",
    targetUserId: "",
    reason: "",
    legalHold: false,
  });

  const requests = useMemo(
    () => compliance?.deletion_requests.pending.length
      ? compliance.deletion_requests.pending
      : compliance?.deletion_requests.recent || [],
    [compliance]
  );

  const loadCompliance = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await adminService.getComplianceDashboard({ limit: 30 });
      setCompliance(data);
      setSelected((current) => {
        if (current && data.deletion_requests.recent.some((item) => String(item.id) === String(current.id))) {
          return data.deletion_requests.recent.find((item) => String(item.id) === String(current.id)) || current;
        }
        return data.deletion_requests.pending[0] || data.deletion_requests.recent[0] || null;
      });
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadCompliance();
    });
    return () => {
      active = false;
    };
  }, [loadCompliance]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSubmitting("create");
      setError("");
      setSuccess("");
      const created = await adminService.createComplianceDeletionRequest({
        requestType: form.requestType,
        subjectType: form.subjectType,
        subjectId: form.subjectId,
        targetUserId: form.targetUserId || null,
        reason: form.reason,
        legalHold: form.legalHold,
      });
      setSuccess("Compliance request created.");
      setSelected(created.request);
      setForm((current) => ({ ...current, subjectId: "", targetUserId: "", reason: "" }));
      await loadCompliance();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  async function runAction(action: "review" | "approve" | "reject" | "execute") {
    if (!selected) return;
    try {
      setSubmitting(action);
      setError("");
      setSuccess("");
      const actions = {
        review: adminService.reviewComplianceDeletionRequest,
        approve: adminService.approveComplianceDeletionRequest,
        reject: adminService.rejectComplianceDeletionRequest,
        execute: adminService.executeComplianceDeletionRequest,
      };
      const detail = await actions[action](selected.id, note || null);
      setSuccess(`Request ${label(action)} saved.`);
      setSelected(detail.request);
      setNote("");
      await loadCompliance();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  async function archiveEvidence(row: ComplianceEvidenceRow) {
    try {
      setSubmitting(String(row.id));
      setError("");
      setSuccess("");
      await adminService.archiveComplianceEvidence(row.evidence_type, row.id, "Archived from compliance dashboard");
      setSuccess("Evidence archived.");
      await loadCompliance();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting("");
    }
  }

  const summary = compliance?.summary;
  const protectedDomains: Array<[string, unknown, string]> = compliance
    ? [
        ["Financial", compliance.financial_retention_status.ledger_entries, compliance.financial_retention_status.retention_policy_key],
        ["Trust Replay", compliance.trust_retention_status.trust_events, compliance.trust_retention_status.retention_policy_key],
        ["Audit", compliance.audit_retention_status.compliance_events, compliance.audit_retention_status.retention_policy_key],
        ["Incidents", compliance.incident_retention_status.incident_records, compliance.incident_retention_status.retention_policy_key],
      ]
    : [];
  const nextActions: Array<{ action: "review" | "approve" | "reject" | "execute"; label: string; icon: React.ReactNode }> =
    selected?.status === "REQUESTED"
      ? [
          { action: "review", label: "Review", icon: <Clock className="h-4 w-4" aria-hidden="true" /> },
          { action: "approve", label: "Approve", icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> },
          { action: "reject", label: "Reject", icon: <Trash2 className="h-4 w-4" aria-hidden="true" /> },
        ]
      : selected?.status === "UNDER_REVIEW"
        ? [
            { action: "approve", label: "Approve", icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> },
            { action: "reject", label: "Reject", icon: <Trash2 className="h-4 w-4" aria-hidden="true" /> },
          ]
        : selected?.status === "APPROVED"
          ? [{ action: "execute", label: "Execute", icon: <UserX className="h-4 w-4" aria-hidden="true" /> }]
          : [];

  return (
    <AdminShell
      title="Compliance"
      description="Retention policies, deletion requests, evidence archival, and protected record status."
    >
      {error && <AdminStateBlock title={error} tone="error" />}
      {success && <AdminStateBlock title={success} />}

      <div className="flex justify-end gap-2">
        <Link
          href="/admin/audit-center?domains=compliance&limit=50"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-100"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          Audit Trail
        </Link>
        <button
          type="button"
          onClick={() => void loadCompliance()}
          disabled={loading}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh compliance dashboard"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !compliance ? (
        <AdminStateBlock title="Loading compliance dashboard..." />
      ) : !compliance ? (
        <AdminStateBlock title="Compliance dashboard is unavailable." />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminMetricCard
              label="Policies"
              value={display(summary?.retention_policies)}
              detail="Central registry"
            />
            <AdminMetricCard
              label="Pending Requests"
              value={display(summary?.pending_deletion_requests)}
              detail="Review queue"
            />
            <AdminMetricCard
              label="Evidence Assets"
              value={display(summary?.evidence_assets)}
              detail={`${display(summary?.archived_evidence_assets)} archived`}
            />
            <AdminMetricCard
              label="Notification Candidates"
              value={display(summary?.notification_archive_candidates)}
              detail="Archive eligible"
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <SectionPanel
              title="Deletion Requests"
              icon={<FileText className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            >
              <RequestList
                requests={requests}
                selectedId={selected?.id}
                onSelect={setSelected}
              />
            </SectionPanel>

            <div className="space-y-4">
              <form
                onSubmit={submitCreate}
                className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <UserX className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-zinc-950">Create Request</h2>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Type</span>
                    <select
                      value={form.requestType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          requestType: event.target.value as ComplianceRequestType,
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    >
                      {REQUEST_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {label(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Subject</span>
                    <select
                      value={form.subjectType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          subjectType: event.target.value as ComplianceSubjectType,
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    >
                      {SUBJECT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {label(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium text-zinc-700">Subject id</span>
                    <input
                      value={form.subjectId}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, subjectId: event.target.value }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                      required
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium text-zinc-700">Target user id</span>
                    <input
                      value={form.targetUserId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          targetUserId: event.target.value,
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium text-zinc-700">Reason</span>
                    <textarea
                      value={form.reason}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, reason: event.target.value }))
                      }
                      className="mt-1 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                      required
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                    <input
                      type="checkbox"
                      checked={form.legalHold}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, legalHold: event.target.checked }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Legal hold
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={submitting === "create"}
                  className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  <UserX className="h-4 w-4" aria-hidden="true" />
                  {submitting === "create" ? "Creating..." : "Create Request"}
                </button>
              </form>

              <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-zinc-950">Selected Request</h2>
                </div>
                {selected ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge value={selected.status} />
                      <span className="text-sm font-semibold text-zinc-950">
                        {label(selected.request_type)}
                      </span>
                    </div>
                    <p className="break-all text-xs text-zinc-500">{String(selected.id)}</p>
                    <p className="text-sm text-zinc-700">{selected.reason}</p>
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Action note"
                      className="min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    />
                    <div className="flex flex-wrap gap-2">
                      {nextActions.map((item) => (
                        <button
                          key={item.action}
                          type="button"
                          disabled={Boolean(submitting)}
                          onClick={() => void runAction(item.action)}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50"
                        >
                          {item.icon}
                          {submitting === item.action ? "Saving..." : item.label}
                        </button>
                      ))}
                      {!nextActions.length && (
                        <span className="inline-flex min-h-10 items-center rounded-md bg-zinc-100 px-3 text-sm font-medium text-zinc-700">
                          {label(selected.status)}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <AdminStateBlock title="Select a request." />
                  </div>
                )}
              </section>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <SectionPanel
              title="Retention Policies"
              icon={<ShieldCheck className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            >
              <PolicyTable policies={compliance.retention_policies} />
            </SectionPanel>

            <SectionPanel
              title="Protected Records"
              icon={<LockKeyhole className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            >
              <ul className="divide-y divide-zinc-100">
                {protectedDomains.map(([name, countValue, policy]) => (
                  <li key={name} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">{name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{policy}</p>
                    </div>
                    <span className="text-sm font-semibold text-zinc-950">
                      {display(countValue)}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <SectionPanel
              title="Evidence Inventory"
              icon={<Archive className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            >
              <div className="grid gap-3 border-b border-zinc-100 p-4 sm:grid-cols-3">
                <AdminMetricCard
                  label="Assets"
                  value={display(compliance.evidence_inventory.summary.total_assets)}
                  detail={formatBytes(compliance.evidence_inventory.summary.total_bytes)}
                />
                <AdminMetricCard
                  label="Archived"
                  value={display(compliance.evidence_inventory.summary.archived_assets)}
                  detail="Cloudinary preserved"
                />
                <AdminMetricCard
                  label="Candidates"
                  value={display(compliance.evidence_inventory.summary.archive_candidates)}
                  detail="Policy eligible"
                />
              </div>
              <EvidenceTable
                evidence={compliance.evidence_inventory.recent}
                onArchive={archiveEvidence}
                submitting={submitting}
              />
            </SectionPanel>

            <SectionPanel
              title="Activity"
              icon={<History className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
            >
              <ul className="divide-y divide-zinc-100">
                {compliance.compliance_activity.recent.length ? (
                  compliance.compliance_activity.recent.map((event) => {
                    const executionLines = complianceExecutionLines(event.metadata);
                    return (
                      <li key={String(event.id)} className="px-4 py-3">
                        <p className="text-sm font-semibold text-zinc-950">
                          {label(event.event_type)}
                        </p>
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {label(event.target_type)} | {String(event.target_id)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {formatGovernanceDate(event.created_at)}
                        </p>
                        {executionLines.length ? (
                          <ul className="mt-2 space-y-1 text-xs text-zinc-600">
                            {executionLines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })
                ) : (
                  <li className="p-4">
                    <AdminStateBlock title="No compliance events yet." />
                  </li>
                )}
              </ul>
            </SectionPanel>
          </section>

          <SectionPanel
            title="Retention Status"
            icon={<Database className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
          >
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <AdminMetricCard
                label="Notifications"
                value={display(compliance.notification_retention_status.total_notifications)}
                detail={`${display(compliance.notification_retention_status.archived_notifications)} archived`}
              />
              <AdminMetricCard
                label="Refund Records"
                value={display(compliance.financial_retention_status.refund_terminal_records)}
                detail="Delete locked"
              />
              <AdminMetricCard
                label="Trust Effects"
                value={display(compliance.trust_retention_status.trust_event_effects)}
                detail="Replay retained"
              />
              <AdminMetricCard
                label="Postmortems"
                value={display(compliance.incident_retention_status.incident_postmortems)}
                detail="Investigation retained"
              />
            </div>
          </SectionPanel>
        </>
      )}
    </AdminShell>
  );
}
