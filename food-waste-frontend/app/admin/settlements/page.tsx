"use client";

import { useCallback, useEffect, useState } from "react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatDateTimeOrFallback } from "@/lib/dateTime";
import { adminService } from "@/services/admin.service";
import toast from "react-hot-toast";
import type {
  AdminProviderSettlementConsoleData,
  AdminProviderSettlementRow,
  AdminProviderSettlementSummaryRow,
  DbId,
  ProviderPayoutAccount,
} from "@shared/contracts/api-contracts";

const FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
] as const;

const VERIFICATION_FILTERS = [
  { value: "all", label: "All Accounts" },
  { value: "verified", label: "Verified" },
  { value: "pending_review", label: "Pending Review" },
  { value: "rejected", label: "Rejected" },
  { value: "no_account", label: "No Account" },
] as const;

type SettlementFilter = (typeof FILTERS)[number]["value"];
type VerificationFilter = (typeof VERIFICATION_FILTERS)[number]["value"];
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

function payoutAccountStatus(account: ProviderPayoutAccount | null) {
  if (!account) return "Not added";
  if (account.verification_status === "verified" || account.is_verified) {
    return "Verified";
  }
  if (account.verification_status === "rejected") {
    return "Rejected";
  }
  return "Pending verification";
}

function payoutAccountStatusMessage(account: ProviderPayoutAccount | null) {
  if (!account) return "No payout account configured.";
  if (account.verification_status === "verified" || account.is_verified) {
    return "Provider payout account is verified.";
  }
  if (account.verification_status === "rejected") {
    return account.rejection_reason || "Provider payout account has been rejected.";
  }
  return "Provider payout account verification is pending.";
}

function isPayoutAccountReady(account: ProviderPayoutAccount | null) {
  return Boolean(
    account &&
      (account.verification_status === "verified" || account.is_verified)
  );
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
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [consoleData, setConsoleData] =
    useState<AdminProviderSettlementConsoleData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SettlementDraft>>({});
  const [loading, setLoading] = useState(true);
  const [accountActionState, setAccountActionState] = useState<
    | { id: string; type: "verify" | "reject" }
    | null
  >(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadSettlements = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await adminService.getProviderSettlementConsole({
        status: filter,
        verificationStatus: verificationFilter,
        search: searchQuery.trim() || undefined,
        providerId: selectedProviderId || undefined,
        limit: 500,
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
  }, [filter, searchQuery, selectedProviderId, verificationFilter]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadSettlements();
    });
    return () => {
      active = false;
    };
  }, [loadSettlements]);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setSelectedProviderId(null);
    setConsoleData((current) =>
      current ? { ...current, settlements: [] } : current
    );
  }

  function handleFilterChange(value: SettlementFilter) {
    setFilter(value);
    setConsoleData((current) =>
      current ? { ...current, settlements: [] } : current
    );
  }

  function selectProvider(providerId: string) {
    setSelectedProviderId(providerId);
    setConsoleData((current) =>
      current ? { ...current, settlements: [] } : current
    );
  }

  function clearSelectedProvider() {
    setSelectedProviderId(null);
    setConsoleData((current) =>
      current ? { ...current, settlements: [] } : current
    );
  }

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

  async function handleVerifyPayoutAccount(accountId: DbId | null | undefined) {
    if (!accountId) {
      setError("No payout account available to verify.");
      return;
    }

    const stringId = String(accountId);
    try {
      setAccountActionState({ id: stringId, type: "verify" });
      setError("");
      setSuccess("Updating...");
      await adminService.verifyProviderPayoutAccount(accountId);
      toast.success("Payout account verified.");
      setSuccess("Payout account verified.");
      await loadSettlements();
    } catch (err) {
      const message = adminService.getErrorMessage(err);
      setError(message);
      setSuccess("");
      toast.error(message);
    } finally {
      setAccountActionState(null);
    }
  }

  async function handleRejectPayoutAccount(accountId: DbId | null | undefined) {
    if (!accountId) {
      setError("No payout account available to reject.");
      return;
    }

    const reason = window.prompt(
      "Enter rejection reason for the payout account:",
      ""
    )?.trim();

    if (reason === null) {
      return;
    }

    const stringId = String(accountId);
    try {
      setAccountActionState({ id: stringId, type: "reject" });
      setError("");
      setSuccess("Updating...");
      await adminService.rejectProviderPayoutAccount(accountId, reason || "");
      toast.success("Payout account rejected.");
      setSuccess("Payout account rejected.");
      await loadSettlements();
    } catch (err) {
      const message = adminService.getErrorMessage(err);
      setError(message);
      setSuccess("");
      toast.error(message);
    } finally {
      setAccountActionState(null);
    }
  }

  async function runSettlementAction(
    settlement: AdminProviderSettlementRow,
    action: "paid" | "failed"
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
      } else {
        await adminService.markProviderSettlementFailed(settlement.id, {
          notes,
        });
        setSuccess("Settlement marked failed.");
      }

      await loadSettlements();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmittingId(null);
    }
  }

  const providerSummary = consoleData?.summary || [];
  const verificationCounts = providerSummary.reduce(
    (counts, row) => {
      const account = row.payout_account;
      if (!account) {
        counts.no_account += 1;
      } else if (account.verification_status === "verified" || account.is_verified) {
        counts.verified += 1;
      } else if (account.verification_status === "rejected") {
        counts.rejected += 1;
      } else {
        counts.pending += 1;
      }
      return counts;
    },
    { verified: 0, pending: 0, rejected: 0, no_account: 0 }
  );
  const selectedProvider = selectedProviderId
    ? providerSummary.find((row) => String(row.provider_id) === selectedProviderId) ||
      null
    : null;
  const metricSummary: AdminProviderSettlementSummaryRow[] = selectedProvider
    ? [selectedProvider]
    : providerSummary;
  const settlements = selectedProvider ? consoleData?.settlements || [] : [];
  const totalAmountDue = metricSummary.reduce(
    (sum, row) => sum + Number(row.amount_due || 0),
    0
  );
  const pendingSettlementCount = metricSummary.reduce(
    (sum, row) => sum + Number(row.pending_settlements || 0),
    0
  );

  return (
    <AdminShell
      title="Provider Settlements"
      description="Track provider earnings and manually record payout outcomes. No bank transfer is executed here."
    >
      {error && <AdminStateBlock title={error} tone="error" />}
      {success && !accountActionState && <AdminStateBlock title={success} />}
      {accountActionState && (
        <AdminStateBlock
          title={`Status: ${accountActionState.type === "verify" ? "Updating verification" : "Updating rejection"}...`}
          tone="info"
        />
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <label className="block max-w-xl text-sm">
          <span className="font-medium text-zinc-700">Provider search</span>
          <input
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search provider, restaurant, or payout account"
            className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => handleFilterChange(item.value)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                filter === item.value
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {VERIFICATION_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setVerificationFilter(item.value);
                setSelectedProviderId(null);
                setConsoleData((current) =>
                  current ? { ...current, settlements: [] } : current
                );
              }}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                verificationFilter === item.value
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <AdminMetricCard
          label="Providers"
          value={metricSummary.length}
          detail={selectedProvider ? "Selected provider" : "Matching providers"}
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
          label="Verified Accounts"
          value={verificationCounts.verified}
          detail="Active verified accounts"
        />
        <AdminMetricCard
          label="Pending Review"
          value={verificationCounts.pending}
          detail="Awaiting admin review"
        />
        <AdminMetricCard
          label="Rejected Accounts"
          value={verificationCounts.rejected}
          detail="Rejected payout accounts"
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">
            Provider Summary
          </h2>
          {selectedProvider && (
            <button
              type="button"
              onClick={clearSelectedProvider}
              className="mt-2 text-sm font-medium text-zinc-700 underline-offset-4 hover:underline"
            >
              Clear selected provider
            </button>
          )}
        </div>
        {loading ? (
          <div className="p-4">
            <AdminStateBlock title="Loading settlements..." />
          </div>
        ) : providerSummary.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="No providers match this search." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-100 text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Pending Amount</th>
                  <th className="px-4 py-3">Pending Count</th>
                  <th className="px-4 py-3">Last Settlement</th>
                  <th className="px-4 py-3">Payout Account Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {providerSummary.map((row) => {
                  const rowProviderId = String(row.provider_id);
                  const selected = rowProviderId === selectedProviderId;
                  return (
                    <tr
                      key={rowProviderId}
                      className={selected ? "bg-zinc-50" : "hover:bg-zinc-50"}
                    >
                      <td className="px-4 py-3 font-medium text-zinc-950">
                        <button
                          type="button"
                          onClick={() => selectProvider(rowProviderId)}
                          className="text-left font-medium text-zinc-950 underline-offset-4 hover:underline"
                        >
                          {providerName(row)}
                        </button>
                        {row.restaurant_name &&
                          row.restaurant_name !== row.provider_name && (
                            <p className="mt-1 text-xs font-normal text-zinc-500">
                              {row.provider_name ||
                                row.provider_phone ||
                                "Provider"}
                            </p>
                          )}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCurrency(row.amount_due)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {row.pending_settlements} pending
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatDateTimeOrFallback(row.last_settlement_at ?? null)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        <p className="font-medium text-zinc-800">
                          {payoutAccountStatus(row.payout_account)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {payoutAccountLabel(row.payout_account)}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">
            {selectedProvider
              ? `${providerName(selectedProvider)} Settlement Details`
              : "Settlement Details"}
          </h2>
          {selectedProvider && (
            <div className="mt-3 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">Payout Account</p>
                  <p className="text-sm text-zinc-700">
                    {payoutAccountLabel(selectedProvider.payout_account)}
                  </p>
                </div>
                <div className="text-sm text-zinc-700">
                  <span className="font-semibold">Status:</span> {payoutAccountStatus(selectedProvider.payout_account)}
                </div>
              </div>
              {selectedProvider.payout_account ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase text-zinc-500">Verification</p>
                    <p className="text-sm font-medium text-zinc-900">{payoutAccountStatus(selectedProvider.payout_account)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-zinc-500">Verified By</p>
                    <p className="text-sm text-zinc-700">
                      {selectedProvider.payout_account.verified_by || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-zinc-500">Verified At</p>
                    <p className="text-sm text-zinc-700">
                      {formatDateTimeOrFallback(selectedProvider.payout_account.verified_at || null)}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {selectedProvider.payout_account &&
                  selectedProvider.payout_account.verification_status !== "verified" && (
                    <button
                      type="button"
                      onClick={() => handleVerifyPayoutAccount(selectedProvider.payout_account?.id)}
                      disabled={Boolean(accountActionState)}
                      className={`inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-white ${
                        accountActionState?.type === "verify"
                          ? "bg-emerald-700"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      } disabled:opacity-50`}
                    >
                      {accountActionState?.type === "verify" ? "Verifying..." : "Verify"}
                    </button>
                  )}
                {selectedProvider.payout_account && (
                  <button
                    type="button"
                    onClick={() => handleRejectPayoutAccount(selectedProvider.payout_account?.id)}
                    disabled={Boolean(accountActionState)}
                    className={`inline-flex min-h-9 items-center justify-center rounded-md border px-3 text-sm font-medium ${
                      accountActionState?.type === "reject"
                        ? "border-red-300 bg-red-100 text-red-700"
                        : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    } disabled:opacity-50`}
                  >
                    {accountActionState?.type === "reject" ? "Rejecting..." : selectedProvider.payout_account.verification_status === "rejected" ? "Re-Verify" : "Reject"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {!selectedProvider ? (
          <div className="p-4">
            <AdminStateBlock title="Select a provider to view settlement details." />
          </div>
        ) : settlements.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock
              title={`No ${label(filter).toLowerCase()} settlement rows for this provider.`}
            />
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
                        {(() => {
                          const payoutVerified = isPayoutAccountReady(
                            settlement.payout_account
                          );
                          const markPaidDisabled =
                            paid ||
                            submittingId === `${rowKey}:paid` ||
                            !payoutVerified;
                          return (
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => runSettlementAction(settlement, "paid")}
                                disabled={markPaidDisabled}
                                title={
                                  markPaidDisabled && !paid
                                    ? payoutAccountStatusMessage(
                                        settlement.payout_account
                                      )
                                    : undefined
                                }
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
                              {!paid && (
                                <p className="text-xs text-zinc-500">
                                  {payoutAccountStatusMessage(
                                    settlement.payout_account
                                  )}
                                </p>
                              )}
                            </div>
                          );
                        })()}
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
