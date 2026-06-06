"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Eye,
  MessageSquare,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import {
  adminService,
  type AdminModerationCase,
} from "@/services/admin.service";
import type {
  ModerationCaseStatus,
  ProviderReportAttachmentRow,
} from "@shared/contracts/api-contracts";

type StatusAction = {
  status: ModerationCaseStatus;
  label: string;
  tone: string;
  icon: typeof Clock3;
};

const WORKFLOW_ACTIONS: StatusAction[] = [
  {
    status: "UNDER_REVIEW",
    label: "Under review",
    tone: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    icon: Eye,
  },
  {
    status: "AWAITING_RESPONSE",
    label: "Awaiting response",
    tone: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    icon: MessageSquare,
  },
  {
    status: "ESCALATED",
    label: "Escalate",
    tone: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    icon: ShieldAlert,
  },
];

const TERMINAL_STATUSES = new Set(["VALIDATED", "DISMISSED"]);

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

function formatFileSize(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function eventTitle(eventType: string) {
  if (eventType === "CASE_OPENED") return "Case opened";
  if (eventType === "CASE_STATUS_CHANGED") return "Status changed";
  return displayLabel(eventType);
}

export default function ModerationCaseDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const caseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [moderationCase, setModerationCase] = useState<AdminModerationCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [previewAttachment, setPreviewAttachment] =
    useState<ProviderReportAttachmentRow | null>(null);

  useEffect(() => {
    let active = true;

    queueMicrotask(async () => {
      try {
        setLoading(true);
        setError("");
        const result = await adminService.getModerationCase(caseId);
        if (active) setModerationCase(result);
      } catch (err) {
        if (active) setError(adminService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [caseId]);

  const transition = async (status: ModerationCaseStatus) => {
    try {
      setProcessingStatus(status);
      setError("");
      setSuccess("");
      const updated = await adminService.updateModerationCaseStatus(
        caseId,
        status,
        note.trim() || null
      );
      setModerationCase(updated);
      setNote("");
      setSuccess(`Case moved to ${displayLabel(status)}.`);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setProcessingStatus(null);
    }
  };

  const report = moderationCase?.report || null;
  const attachments = Array.isArray(report?.attachments) ? report.attachments : [];
  const terminal = TERMINAL_STATUSES.has(String(moderationCase?.status || ""));
  const pendingReport = report?.status === "pending";

  return (
    <AdminShell
      title="Moderation Case"
      description="Review provider report context, evidence, and case history."
    >
      <Link
        href="/admin/provider-reports"
        className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-950"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Provider reports
      </Link>

      {error && <AdminStateBlock title={error} tone="error" />}
      {success && <AdminStateBlock title={success} />}

      {loading ? (
        <AdminStateBlock title="Loading moderation case..." />
      ) : !moderationCase ? (
        <AdminStateBlock title="Moderation case not found." tone="error" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
          <section className="space-y-5">
            <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    {displayLabel(moderationCase.reason || report?.reason)}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-950">
                    {displayValue(moderationCase.provider_name)}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Case {displayValue(moderationCase.id)}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusBadge(
                    moderationCase.status
                  )}`}
                >
                  {displayLabel(moderationCase.status)}
                </span>
              </div>

              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Provider
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {displayValue(moderationCase.subject_id)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Assigned Admin
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {displayValue(moderationCase.assigned_admin_name)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Opened
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatDate(moderationCase.created_at)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Updated
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatDate(moderationCase.updated_at)}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Provider Report
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-zinc-950">
                    {displayLabel(report?.reason)}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Reported by {displayValue(report?.reporter_name)} ({displayLabel(report?.reporter_role)})
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusBadge(
                    report?.status
                  )}`}
                >
                  {displayValue(report?.status)}
                </span>
              </div>

              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Reservation
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {displayValue(report?.reservation_id)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Listing
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {displayValue(report?.listing_title)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Reservation Status
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {displayLabel(report?.reservation_task_status || report?.reservation_status)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Submitted
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatDate(report?.created_at)}
                  </dd>
                </div>
              </dl>

              {report?.description && (
                <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  {report.description}
                </p>
              )}

              {attachments.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Evidence
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {attachments.map((attachment) => {
                      const url = adminService.getAssetUrl(attachment.file_url);
                      if (!url) return null;

                      return (
                        <button
                          key={String(attachment.id)}
                          type="button"
                          onClick={() => setPreviewAttachment(attachment)}
                          className="group overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-left transition hover:border-zinc-400"
                        >
                          <span className="block aspect-[4/3] overflow-hidden">
                            <img
                              src={url}
                              alt="Provider report evidence"
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                          </span>
                          <span className="block truncate px-2 py-1 text-xs text-zinc-500">
                            {formatFileSize(attachment.file_size_bytes) ||
                              displayValue(attachment.mime_type)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          </section>

          <aside className="space-y-5">
            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-950">Case Actions</h2>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Audit note"
                disabled={terminal}
                className="mt-3 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:bg-zinc-100"
              />

              <div className="mt-3 grid gap-2">
                {WORKFLOW_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.status}
                      type="button"
                      onClick={() => transition(action.status)}
                      disabled={terminal || processingStatus !== null}
                      className={`inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${action.tone}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {action.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-2 border-t border-zinc-200 pt-4">
                <button
                  type="button"
                  onClick={() => transition("VALIDATED")}
                  disabled={terminal || !pendingReport || processingStatus !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Validate report
                </button>
                <button
                  type="button"
                  onClick={() => transition("DISMISSED")}
                  disabled={terminal || !pendingReport || processingStatus !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Dismiss report
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-950">Timeline</h2>
              <ol className="mt-4 space-y-3">
                {moderationCase.events.map((event) => (
                  <li
                    key={String(event.id)}
                    className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-zinc-700">
                        {event.event_type === "CASE_STATUS_CHANGED" ? (
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Clock3 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-950">
                          {eventTitle(event.event_type)}
                        </p>
                        {event.from_status || event.to_status ? (
                          <p className="mt-1 text-xs text-zinc-600">
                            {displayLabel(event.from_status)} to {displayLabel(event.to_status)}
                          </p>
                        ) : null}
                        {event.note && (
                          <p className="mt-2 text-sm text-zinc-700">{event.note}</p>
                        )}
                        <p className="mt-2 text-xs text-zinc-500">
                          {formatDate(event.created_at)} by {displayValue(event.actor_name || event.actor_role)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      )}

      {previewAttachment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="relative max-h-full w-full max-w-4xl overflow-hidden rounded-lg bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewAttachment(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <img
              src={adminService.getAssetUrl(previewAttachment.file_url) || ""}
              alt="Provider report evidence preview"
              className="max-h-[82vh] w-full object-contain"
            />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
