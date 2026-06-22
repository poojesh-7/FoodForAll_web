"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import {
  adminService,
  type AdminFinancialSummary,
} from "@/services/admin.service";

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value: unknown, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export default function AdminFinancialsPage() {
  const [summary, setSummary] = useState<AdminFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async (isActive: () => boolean = () => true) => {
    try {
      if (isActive()) {
        setLoading(true);
        setError("");
      }
      const result = await adminService.getFinancialSummary({ limit: 25 });
      if (isActive()) setSummary(result);
    } catch (err) {
      if (isActive()) setError(adminService.getErrorMessage(err));
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      void loadSummary(() => active);
    });
    return () => {
      active = false;
    };
  }, [loadSummary]);

  const currency = summary?.currency || "INR";

  return (
    <AdminShell
      title="Financial Reporting"
      description="Read-only accounting buckets for revenue, deposits, provider settlement obligations, refunds, and gateway fees."
    >
      {error && <AdminStateBlock title={error} tone="error" />}

      <section className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <p className="text-sm text-zinc-600">
          {summary
            ? `Generated ${formatGovernanceDate(summary.generated_at)}`
            : "Financial summary"}
        </p>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={loading}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh financial summary"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </section>

      {loading && !summary ? (
        <AdminStateBlock title="Loading financial summary..." />
      ) : summary ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminMetricCard
              label="Commission Revenue"
              value={formatCurrency(summary.totals.total_commission_revenue, currency)}
              detail="Platform commission bucket"
            />
            <AdminMetricCard
              label="Deposits Held"
              value={formatCurrency(summary.totals.total_deposits_held, currency)}
              detail="Reliability deposit bucket"
            />
            <AdminMetricCard
              label="Provider Liabilities"
              value={formatCurrency(summary.totals.total_provider_liabilities, currency)}
              detail={`${displayValue(summary.provider_settlements.pending_count)} pending`}
            />
            <AdminMetricCard
              label="Provider Paid"
              value={formatCurrency(summary.totals.total_provider_paid, currency)}
              detail={`${displayValue(summary.provider_settlements.paid_count)} paid`}
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminMetricCard
              label="Deposits Refunded"
              value={formatCurrency(summary.totals.total_deposits_refunded, currency)}
              detail="Returned reliability deposits"
            />
            <AdminMetricCard
              label="Deposits Retained"
              value={formatCurrency(summary.totals.total_deposits_retained, currency)}
              detail="Retained reliability deposits"
            />
            <AdminMetricCard
              label="Refund Volume"
              value={formatCurrency(summary.totals.total_refund_volume, currency)}
              detail="Refund expense bucket"
            />
            <AdminMetricCard
              label="Gateway Fees"
              value={formatCurrency(summary.totals.total_gateway_fee_expense, currency)}
              detail={`${displayValue(summary.gateway_fees.recorded_count)} recorded`}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Accounting Buckets
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-100 text-sm">
                  <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Bucket</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Rows</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {summary.classification_totals.map((row) => (
                      <tr key={row.accounting_category}>
                        <td className="px-4 py-3 font-medium text-zinc-950">
                          {row.label}
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          {formatCurrency(row.total, row.currency || currency)}
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          {displayValue(row.count)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Recent Financial Events
                </h2>
              </div>
              {summary.recent_entries.length === 0 ? (
                <div className="p-4">
                  <AdminStateBlock title="No classified financial events yet." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-zinc-100 text-sm">
                    <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                      <tr>
                        <th className="px-4 py-3">Event</th>
                        <th className="px-4 py-3">Bucket</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {summary.recent_entries.map((entry) => (
                        <tr key={String(entry.id)}>
                          <td className="px-4 py-3 font-medium text-zinc-950">
                            {displayValue(entry.event_type)}
                          </td>
                          <td className="px-4 py-3 text-zinc-700">
                            {entry.accounting_category_label}
                          </td>
                          <td className="px-4 py-3 text-zinc-700">
                            {formatCurrency(entry.amount, entry.currency || currency)}
                          </td>
                          <td className="px-4 py-3 text-zinc-700">
                            {entry.created_at
                              ? formatGovernanceDate(entry.created_at)
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}
