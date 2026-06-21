"use client";

import { useCallback, useEffect, useState } from "react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatDateTimeOrFallback } from "@/lib/dateTime";
import { adminService } from "@/services/admin.service";
import type {
  AdminProviderSettlementConsoleData,
  AdminProviderSettlementRow,
  DbId,
  ProviderPayoutAccount,
} from "@shared/contracts/api-contracts";

const FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
] as const;

type SettlementFilter = (typeof FILTERS)[number]["value"];
type SettlementDraft = {
  payment_reference: string;
  notes: string;
};

function formatCurrency(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function label(value: unknown) {
  return String(value || "-")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function providerName(row: {
  restaurant_name?: string | null;
  provider_name?: string | null;
  provider_phone?: string | null;
}) {
  return row.restaurant_name || row.provider_name || row.provider_phone || "Provider";
}

function payoutAccountLabel(account: ProviderPayoutAccount | null) {
  if (!account) return "Not added";
  if (account.account_type === "UPI") return `UPI: ${account.upi_id || "-"}`;

  return [
    account.account_holder_name || "Bank account",
    account.bank_account_number || account.bank_account_number_last4,
    account.ifsc_code,
  ].filter(Boolean).join(" | ");
}

function draftFor(
  drafts: Record<string, SettlementDraft>,
  settlement: AdminProviderSettlementRow
) {
  return drafts[String(settlement.id)] || {
    payment_reference: settlement.payment_reference || "",
    notes: settlement.notes || "",
  };
}

export default function AdminSettlementsPage() {
  const [filter, setFilter] = useState<SettlementFilter>("pending");
  const [consoleData, setConsoleData] =
    useState<AdminProviderSettlementConsoleData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SettlementDraft>>({});
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadSettlements = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await adminService.getProviderSettlementConsole({
        status: filter,
      });
      setConsoleData(result);
      setDrafts((current) => {
        const next = { ...current };
        for (const settlement of result.settlements) {
          const key = String(settlement.id);
          if (!next[key]) {
            next[key] = {
              payment_reference: settlement.payment_reference || "",
              notes: settlement.notes || "",
            };
          }
        }
        return next;
      });
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadSettlements();
    });
    return () => {
      active = false;
    };
  }, [loadSettlements]);

  function updateDraft(
    settlementId: DbId,
    patch: Partial<SettlementDraft>
  ) {
    setDrafts((current) => {
      const key = String(settlementId);
      return {
        ...current,
        [key]: {
          payment_reference: current[key]?.payment_reference || "",
          notes: current[key]?.notes || "",
          ...patch,
        },
      };
    });
  }

  async function runSettlementAction(
    settlement: AdminProviderSettlementRow,
    action: "paid" | "failed" | "notes"
  ) {
    const key = String(settlement.id);
    const draft = draftFor(drafts, settlement);
    const reference = draft.payment_reference.trim();
    const notes = draft.notes.trim();

    if (action === "paid" && !reference && !settlement.payment_reference) {
      setError("Payment reference is required when marking a settlement paid.");
      return;
    }

    try {
      setSubmittingId(`${key}:${action}`);
      setError("");
      setSuccess("");

      if (action === "paid") {
        await adminService.markProviderSettlementPaid(settlement.id, {
          payment_reference: reference || settlement.payment_reference,
          notes,
        });
        setSuccess("Settlement marked paid.");
      } else if (action === "failed") {
        await adminService.markProviderSettlementFailed(settlement.id, {
          notes,
        });
        setSuccess("Settlement marked failed.");
      } else {
        await adminService.updateProviderSettlementNotes(settlement.id, {
          notes,
        });
        setSuccess("Settlement notes updated.");
      }

      await loadSettlements();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmittingId(null);
    }
  }

  const settlements = consoleData?.settlements || [];
  const providerSummary = consoleData?.summary || [];
  const totalAmountDue = providerSummary.reduce(
    (sum, row) => sum + Number(row.amount_due || 0),
    0
  );
  const pendingSettlementCount = providerSummary.reduce(
    (sum, row) => sum + Number(row.pending_settlements || 0),
    0
  );

  return (
    <AdminShell
      title="Provider Settlements"
      description="Track provider earnings and manually record payout outcomes. No bank transfer is executed here."
    >
      {error && <AdminStateBlock title={error} tone="error" />}
      {success && <AdminStateBlock title={success} />}

      <section className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              filter === item.value
                ? "bg-zinc-950 text-white"
                : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {item.label}
          </button>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminMetricCard
          label="Providers"
          value={providerSummary.length}
          detail="Providers in current filter"
        />
        <AdminMetricCard
          label="Amount Due"
          value={formatCurrency(totalAmountDue)}
          detail="Pending provider settlements"
        />
        <AdminMetricCard
          label="Pending Settlements"
          value={pendingSettlementCount}
          detail="Awaiting manual payout"
        />
        <AdminMetricCard
          label="Rows Shown"
          value={settlements.length}
          detail={label(filter)}
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">
            Provider Payout Overview
          </h2>
        </div>
        {loading ? (
          <div className="p-4">
            <AdminStateBlock title="Loading settlements..." />
          </div>
        ) : providerSummary.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="No providers match this filter." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-100 text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Amount Due</th>
                  <th className="px-4 py-3">Pending Settlements</th>
                  <th className="px-4 py-3">Last Settlement</th>
                  <th className="px-4 py-3">Payout Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {providerSummary.map((row) => (
                  <tr key={String(row.provider_id)}>
                    <td className="px-4 py-3 font-medium text-zinc-950">
                      {providerName(row)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatCurrency(row.amount_due)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {row.pending_settlements}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatDateTimeOrFallback(row.last_settlement_at ?? null)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {payoutAccountLabel(row.payout_account)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">
            Settlement Actions
          </h2>
        </div>
        {settlements.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="No settlement rows to show." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-100 text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 align-top">
                {settlements.map((settlement) => {
                  const draft = draftFor(drafts, settlement);
                  const rowKey = String(settlement.id);
                  const paid = settlement.status === "paid";
                  return (
                    <tr key={rowKey}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-950">
                          {providerName(settlement)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {formatDateTimeOrFallback(
                            settlement.paid_at ||
                              settlement.updated_at ||
                              settlement.created_at ||
                              null
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-950">
                        {formatCurrency(settlement.amount)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {label(settlement.status)}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={draft.payment_reference}
                          onChange={(event) =>
                            updateDraft(settlement.id, {
                              payment_reference: event.target.value,
                            })
                          }
                          disabled={paid}
                          placeholder="UTR/reference"
                          className="h-10 min-w-40 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <textarea
                          value={draft.notes}
                          onChange={(event) =>
                            updateDraft(settlement.id, {
                              notes: event.target.value,
                            })
                          }
                          className="min-h-20 min-w-56 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => runSettlementAction(settlement, "paid")}
                            disabled={paid || submittingId === `${rowKey}:paid`}
                            className="inline-flex min-h-9 items-center justify-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {submittingId === `${rowKey}:paid`
                              ? "Saving..."
                              : "Mark Paid"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              runSettlementAction(settlement, "failed")
                            }
                            disabled={paid || submittingId === `${rowKey}:failed`}
                            className="inline-flex min-h-9 items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 disabled:opacity-50"
                          >
                            Mark Failed
                          </button>
                          <button
                            type="button"
                            onClick={() => runSettlementAction(settlement, "notes")}
                            disabled={submittingId === `${rowKey}:notes`}
                            className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 disabled:opacity-50"
                          >
                            Add Notes
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
