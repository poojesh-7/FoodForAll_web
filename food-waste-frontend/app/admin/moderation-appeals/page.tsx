"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ExternalLink, Eye, X, XCircle } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import {
  formatGovernanceDate,
  formatGovernanceStatus,
  governanceStatusBadge,
} from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminModerationAppeal,
} from "@/services/admin.service";
import type { ModerationAppealAttachmentRow } from "@shared/contracts/api-contracts";

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatFileSize(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ModerationAppealsPage() {
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status") || "open";
  const [appeals, setAppeals] = useState<AdminModerationAppeal[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [previewAttachment, setPreviewAttachment] =
    useState<ModerationAppealAttachmentRow | null>(null);

  useEffect(() => {
    let active = true;

    queueMicrotask(async () => {
      try {
        setLoading(true);
        setError("");
        const result = await adminService.getModerationAppeals(statusFilter);
        if (active) setAppeals(result);
      } catch (err) {
        if (active) setError(adminService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [statusFilter]);

  const review = async (
    appeal: AdminModerationAppeal,
    action: "review" | "accept" | "reject"
  ) => {
    try {
      setProcessingId(String(appeal.id));
      setError("");
      setSuccess("");
      const note = notes[String(appeal.id)]?.trim() || null;
      const result =
        action === "review"
          ? await adminService.reviewModerationAppeal(appeal.id, note)
          : action === "accept"
            ? await adminService.acceptModerationAppeal(appeal.id, note)
            : await adminService.rejectModerationAppeal(appeal.id, note);

      setAppeals((current) =>
        ["ACCEPTED", "REJECTED"].includes(String(result.appeal.status))
          ? current.filter((item) => String(item.id) !== String(appeal.id))
          : current.map((item) =>
              String(item.id) === String(appeal.id) ? result.appeal : item
            )
      );
      setNotes((current) => ({ ...current, [String(appeal.id)]: "" }));
      setSuccess(`Appeal moved to ${formatGovernanceStatus(result.appeal.status)}.`);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <AdminShell
      title="Moderation Appeals"
      description="Review provider appeals submitted after final moderation decisions."
    >
      {error && <AdminStateBlock title={error} tone="error" />}
      {success && <AdminStateBlock title={success} />}

      {loading ? (
        <AdminStateBlock title="Loading moderation appeals..." />
      ) : appeals.length === 0 ? (
        <AdminStateBlock
          title={
            statusFilter === "open"
              ? "No open moderation appeals."
              : `No ${formatGovernanceStatus(statusFilter)} moderation appeals.`
          }
        />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {appeals.map((appeal) => {
            const attachments = Array.isArray(appeal.attachments)
              ? appeal.attachments
              : [];
            const processing = processingId === String(appeal.id);

            return (
              <article
                key={String(appeal.id)}
                className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-zinc-500">
                      {formatGovernanceStatus(appeal.report_reason || appeal.case_reason)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-zinc-950">
                      {displayValue(appeal.provider_name)}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {displayValue(appeal.listing_title || appeal.case_summary)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${governanceStatusBadge(
                      appeal.status
                    )}`}
                  >
                    {formatGovernanceStatus(appeal.status)}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <dt className="text-xs font-medium uppercase text-zinc-500">
                      Case
                    </dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {formatGovernanceStatus(appeal.case_status)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <dt className="text-xs font-medium uppercase text-zinc-500">
                      Submitted
                    </dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {formatGovernanceDate(appeal.submitted_at)}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                  {appeal.appeal_text}
                </p>

                {attachments.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase text-zinc-500">
                      Appeal Evidence
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
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

                <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4">
                  {!["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(
                    String(appeal.status).toUpperCase()
                  ) && (
                    <textarea
                      value={notes[String(appeal.id)] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [String(appeal.id)]: event.target.value,
                        }))
                      }
                      placeholder="Decision note"
                      className="min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/moderation-cases/${String(appeal.case_id)}`}
                      className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-100"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Open case
                    </Link>
                    {!["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(
                      String(appeal.status).toUpperCase()
                    ) && (
                      <>
                        <button
                          type="button"
                          onClick={() => review(appeal, "review")}
                          disabled={processing}
                          className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => review(appeal, "accept")}
                          disabled={processing}
                          className="inline-flex items-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => review(appeal, "reject")}
                          disabled={processing}
                          className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
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
              alt="Appeal evidence preview"
              className="max-h-[82vh] w-full object-contain"
            />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
