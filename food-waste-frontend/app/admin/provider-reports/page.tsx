"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ExternalLink, X } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import {
  formatGovernanceDate,
  formatGovernanceStatus,
} from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminProviderReport,
} from "@/services/admin.service";

type ReportAttachment = NonNullable<AdminProviderReport["attachments"]>[number];

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatFileSize(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProviderReportsPage() {
  const searchParams = useSearchParams();
  const reportStatus = searchParams.get("status") === "all" ? "all" : "pending";
  const caseStatusFilter = searchParams.get("caseStatus") || searchParams.get("case_status");
  const [reports, setReports] = useState<AdminProviderReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<ReportAttachment | null>(null);

  useEffect(() => {
    let active = true;

    queueMicrotask(async () => {
      try {
        setLoading(true);
        setError("");
        const result = await adminService.getProviderReports(reportStatus);
        if (active) setReports(result);
      } catch (err) {
        if (active) setError(adminService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [reportStatus]);

  const review = async (report: AdminProviderReport, action: "validate" | "dismiss") => {
    try {
      setProcessingId(String(report.id));
      setError("");
      setSuccess("");
      if (action === "validate") {
        await adminService.validateProviderReport(report.id);
      } else {
        await adminService.dismissProviderReport(report.id);
      }
      setReports((current) =>
        current.filter((item) => String(item.id) !== String(report.id))
      );
      setSuccess(action === "validate" ? "Report validated." : "Report dismissed.");
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <AdminShell
      title="Provider Reports"
      description="Review reported provider issues and validate only the reports that should affect moderation."
    >
      {error && <AdminStateBlock title={error} tone="error" />}
      {success && <AdminStateBlock title={success} />}

      {loading ? (
        <AdminStateBlock title="Loading provider reports..." />
      ) : reports.filter((report) =>
          caseStatusFilter
            ? String(report.moderation_case_status || "").toUpperCase() ===
              caseStatusFilter.toUpperCase()
            : true
        ).length === 0 ? (
        <AdminStateBlock
          title={
            caseStatusFilter
              ? `No ${formatGovernanceStatus(caseStatusFilter)} provider reports.`
              : reportStatus === "all"
                ? "No provider reports."
                : "No pending provider reports."
          }
        />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {reports
            .filter((report) =>
              caseStatusFilter
                ? String(report.moderation_case_status || "").toUpperCase() ===
                  caseStatusFilter.toUpperCase()
                : true
            )
            .map((report) => (
            <article
              key={String(report.id)}
              className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    {formatGovernanceStatus(report.reason)}
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-zinc-950">
                    {displayValue(report.provider_name)}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Reported by {displayValue(report.reporter_name)} ({formatGovernanceStatus(report.reporter_role)})
                  </p>
                </div>
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                  {formatGovernanceStatus(report.moderation_case_status || report.status)}
                </span>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Reservation
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {displayValue(report.reservation_id)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Listing
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {displayValue(report.listing_title)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Reservation Status
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatGovernanceStatus(report.reservation_task_status || report.reservation_status)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Created
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatGovernanceDate(report.created_at)}
                  </dd>
                </div>
              </dl>
              {report.description && (
                <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  {report.description}
                </p>
              )}
              {Array.isArray(report.attachments) && report.attachments.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    Evidence
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {report.attachments.map((attachment) => {
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
                            {formatFileSize(attachment.file_size_bytes) || displayValue(attachment.mime_type)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {report.moderation_case_id && (
                  <Link
                    href={`/admin/moderation-cases/${String(report.moderation_case_id)}`}
                    className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-100"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Open case
                  </Link>
                )}
                {String(report.status).toLowerCase() === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => review(report, "validate")}
                      disabled={processingId === String(report.id)}
                      className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Validate
                    </button>
                    <button
                      type="button"
                      onClick={() => review(report, "dismiss")}
                      disabled={processingId === String(report.id)}
                      className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
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
              alt="Provider report evidence preview"
              className="max-h-[82vh] w-full object-contain"
            />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
