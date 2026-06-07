"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Eye,
  History,
  MessageSquare,
  Scale,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import {
  formatGovernanceDate,
  formatGovernanceStatus,
  getGovernanceEventPresentation,
  governanceStatusBadge,
} from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminModerationCase,
} from "@/services/admin.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  ModerationAppealAttachmentRow,
  ModerationCaseStatus,
  ProviderCaseResponseAttachmentRow,
  ProviderReportAttachmentRow,
} from "@shared/contracts/api-contracts";

type StatusAction = {
  status: ModerationCaseStatus;
  label: string;
  tone: string;
  icon: typeof Clock3;
};

type EvidenceAttachment =
  | ProviderReportAttachmentRow
  | ProviderCaseResponseAttachmentRow
  | ModerationAppealAttachmentRow;

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
const TERMINAL_APPEAL_STATUSES = new Set(["ACCEPTED", "REJECTED", "WITHDRAWN"]);

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatFileSize(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ModerationCaseDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const caseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const moderationCaseEvent = useRealtimeStore(
    (state) => state.moderationCases[String(caseId)]
  );
  const [moderationCase, setModerationCase] = useState<AdminModerationCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [processingAppeal, setProcessingAppeal] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [appealNote, setAppealNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [previewAttachment, setPreviewAttachment] =
    useState<EvidenceAttachment | null>(null);

  const loadCase = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) setLoading(true);
        setError("");
        const result = await adminService.getModerationCase(caseId);
        setModerationCase(result);
      } catch (err) {
        setError(adminService.getErrorMessage(err));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [caseId]
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadCase(true);
    });
  }, [loadCase]);

  useEffect(() => {
    if (!moderationCaseEvent) return;
    queueMicrotask(() => {
      void loadCase(false);
    });
  }, [loadCase, moderationCaseEvent]);

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
      setSuccess(`Case moved to ${formatGovernanceStatus(status)}.`);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setProcessingStatus(null);
    }
  };

  const reviewAppeal = async (action: "review" | "accept" | "reject") => {
    const appeal = moderationCase?.appeal;
    if (!appeal) return;

    try {
      setProcessingAppeal(action);
      setError("");
      setSuccess("");
      const noteValue = appealNote.trim() || null;
      const result =
        action === "review"
          ? await adminService.reviewModerationAppeal(appeal.id, noteValue)
          : action === "accept"
            ? await adminService.acceptModerationAppeal(appeal.id, noteValue)
            : await adminService.rejectModerationAppeal(appeal.id, noteValue);
      setModerationCase(result.case);
      setAppealNote("");
      setSuccess(`Appeal moved to ${formatGovernanceStatus(result.appeal.status)}.`);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setProcessingAppeal(null);
    }
  };

  const report = moderationCase?.report || null;
  const attachments = Array.isArray(report?.attachments) ? report.attachments : [];
  const providerResponse = moderationCase?.provider_response || null;
  const providerResponseAttachments = Array.isArray(providerResponse?.attachments)
    ? providerResponse.attachments
    : [];
  const appeal = moderationCase?.appeal || null;
  const appealAttachments = Array.isArray(appeal?.attachments)
    ? appeal.attachments
    : [];
  const terminal = TERMINAL_STATUSES.has(String(moderationCase?.status || ""));
  const appealTerminal = TERMINAL_APPEAL_STATUSES.has(String(appeal?.status || ""));
  const pendingReport = report?.status === "pending";

  return (
    <AdminShell
      title="Moderation Case"
      description="Review provider report context, evidence, and case history."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/provider-reports"
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Provider reports
        </Link>
        <Link
          href={`/admin/audit-center?domains=moderation,appeals&q=${encodeURIComponent(String(caseId))}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-950"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          Audit trail
        </Link>
      </div>

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
                    {formatGovernanceStatus(moderationCase.reason || report?.reason)}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-950">
                    {displayValue(moderationCase.provider_name)}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Case {displayValue(moderationCase.id)}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${governanceStatusBadge(
                    moderationCase.status
                  )}`}
                >
                  {formatGovernanceStatus(moderationCase.status)}
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
                    {formatGovernanceDate(moderationCase.created_at)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Updated
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatGovernanceDate(moderationCase.updated_at)}
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
                    {formatGovernanceStatus(report?.reason)}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Reported by {displayValue(report?.reporter_name)} ({formatGovernanceStatus(report?.reporter_role)})
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${governanceStatusBadge(
                    report?.status
                  )}`}
                >
                  {formatGovernanceStatus(report?.status)}
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
                    {formatGovernanceStatus(report?.reservation_task_status || report?.reservation_status)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Submitted
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatGovernanceDate(report?.created_at)}
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
                    Reporter Evidence
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

            <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Provider Response
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-zinc-950">
                    {providerResponse ? "Response on file" : "No provider response yet"}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {providerResponse
                      ? `Updated ${formatGovernanceDate(providerResponse.updated_at)}`
                      : "Move the case to awaiting response when provider input is needed."}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${
                    providerResponse
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-zinc-200 bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {providerResponse ? "Submitted" : "Pending"}
                </span>
              </div>

              {providerResponse ? (
                <>
                  <p className="mt-4 whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                    {providerResponse.response_text}
                  </p>

                  {providerResponseAttachments.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Provider Evidence
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {providerResponseAttachments.map((attachment) => {
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
                                  alt="Provider response evidence"
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
                </>
              ) : (
                <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                  The provider has not submitted a response for this case.
                </p>
              )}
            </article>

            <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Appeal
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-zinc-950">
                    {appeal ? "Appeal on file" : "No appeal submitted"}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {appeal
                      ? `Updated ${formatGovernanceDate(appeal.updated_at)}`
                      : "Appeals appear after providers challenge a final decision."}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${
                    appeal
                      ? governanceStatusBadge(appeal.status)
                      : "border-zinc-200 bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {appeal ? formatGovernanceStatus(appeal.status) : "None"}
                </span>
              </div>

              {appeal ? (
                <div className="mt-4 space-y-4">
                  <p className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                    {appeal.appeal_text}
                  </p>

                  {appeal.decision_note && (
                    <p className="rounded-md border border-zinc-200 bg-white p-3 text-sm leading-6 text-zinc-700">
                      {appeal.decision_note}
                    </p>
                  )}

                  {appealAttachments.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Appeal Evidence
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {appealAttachments.map((attachment) => {
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
                                  alt="Appeal evidence"
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

                  {Array.isArray(appeal.events) && appeal.events.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Appeal Timeline
                      </p>
                      <ol className="mt-2 space-y-2">
                        {appeal.events.map((event) => {
                          const presentation =
                            getGovernanceEventPresentation(event);

                          return (
                            <li
                              key={String(event.id)}
                              className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                            >
                              <p className="text-sm font-semibold text-zinc-950">
                                {presentation.title}
                              </p>
                              {presentation.description && (
                                <p className="mt-1 text-xs text-zinc-600">
                                  {presentation.description}
                                </p>
                              )}
                              {event.note && (
                                <p className="mt-2 text-sm text-zinc-700">
                                  {event.note}
                                </p>
                              )}
                              <p className="mt-2 text-xs text-zinc-500">
                                {formatGovernanceDate(event.created_at)} by{" "}
                                {displayValue(event.actor_name || event.actor_role)}
                              </p>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}

                  {!appealTerminal && (
                    <div className="space-y-3 border-t border-zinc-200 pt-4">
                      <textarea
                        value={appealNote}
                        onChange={(event) => setAppealNote(event.target.value)}
                        placeholder="Appeal decision note"
                        className="min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
                      />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => reviewAppeal("review")}
                          disabled={processingAppeal !== null}
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewAppeal("accept")}
                          disabled={processingAppeal !== null}
                          className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewAppeal("reject")}
                          disabled={processingAppeal !== null}
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                  No appeal has been submitted for this case.
                </p>
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
                {moderationCase.events.map((event) => {
                  const presentation = getGovernanceEventPresentation(event);

                  return (
                    <li
                      key={String(event.id)}
                      className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-zinc-700">
                          {event.event_type === "CASE_STATUS_CHANGED" ? (
                            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                          ) : event.event_type.includes("APPEAL") ? (
                            <Scale className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Clock3 className="h-4 w-4" aria-hidden="true" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-950">
                            {presentation.title}
                          </p>
                          {presentation.description && (
                            <p className="mt-1 text-xs text-zinc-600">
                              {presentation.description}
                            </p>
                          )}
                          {event.note && (
                            <p className="mt-2 text-sm text-zinc-700">{event.note}</p>
                          )}
                          <p className="mt-2 text-xs text-zinc-500">
                            {formatGovernanceDate(event.created_at)} by {displayValue(event.actor_name || event.actor_role)}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
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
