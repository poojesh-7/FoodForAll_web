"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import {
  adminService,
  type AdminProviderReport,
} from "@/services/admin.service";

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function displayLabel(value: unknown) {
  return displayValue(value).replace(/_/g, " ");
}

function formatDate(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ProviderReportsPage() {
  const [reports, setReports] = useState<AdminProviderReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    queueMicrotask(async () => {
      try {
        setLoading(true);
        setError("");
        const result = await adminService.getProviderReports("pending");
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
  }, []);

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
      ) : reports.length === 0 ? (
        <AdminStateBlock title="No pending provider reports." />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {reports.map((report) => (
            <article
              key={String(report.id)}
              className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500">
                    {displayLabel(report.reason)}
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-zinc-950">
                    {displayValue(report.provider_name)}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Reported by {displayValue(report.reporter_name)} ({displayLabel(report.reporter_role)})
                  </p>
                </div>
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                  {displayValue(report.status)}
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
                    {displayLabel(report.reservation_task_status || report.reservation_status)}
                  </dd>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Created
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatDate(report.created_at)}
                  </dd>
                </div>
              </dl>
              {report.description && (
                <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  {report.description}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
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
              </div>
            </article>
          ))}
        </section>
      )}
    </AdminShell>
  );
}
