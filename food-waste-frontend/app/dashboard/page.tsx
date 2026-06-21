"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import ImpactMetricGrid from "@/components/analytics/ImpactMetricGrid";
import ProviderReputation from "@/components/ratings/ProviderReputation";
import { formatDateTime, formatVisibleDateTimes } from "@/lib/dateTime";
import { getRoleDashboard } from "@/lib/onboarding";
import { impactService } from "@/services/impact.service";
import { providerFinancialService } from "@/services/providerFinancial.service";
import { ratingService } from "@/services/rating.service";
import { useAuthStore } from "@/store/authStore";
import type {
  ImpactSummary,
  ProviderPayoutAccount,
  ProviderPayoutAccountType,
  ProviderRatingSummary,
  ProviderSettlementSummaryData,
} from "@shared/contracts/api-contracts";
import { useRouter } from "next/navigation";

function formatRestrictionDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? formatDateTime(date) : null;
}

function displayRestrictionReason(value: unknown) {
  return formatVisibleDateTimes(
    String(value || "Successful pickups gradually restore trust.")
  );
}

function formatCurrency(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function displayAccount(account: ProviderPayoutAccount | null) {
  if (!account) return "No active payout account";
  if (account.account_type === "UPI") return account.upi_id || "UPI";
  return [
    account.account_holder_name,
    account.bank_account_number_last4
      ? `Acct ${account.bank_account_number_last4}`
      : account.bank_account_number,
    account.ifsc_code,
  ].filter(Boolean).join(" | ");
}

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [userImpact, setUserImpact] = useState<ImpactSummary | null>(null);
  const [platformImpact, setPlatformImpact] = useState<ImpactSummary | null>(null);
  const [providerRatings, setProviderRatings] =
    useState<ProviderRatingSummary | null>(null);
  const [financialSummary, setFinancialSummary] =
    useState<ProviderSettlementSummaryData | null>(null);
  const [payoutAccount, setPayoutAccount] =
    useState<ProviderPayoutAccount | null>(null);
  const [accountType, setAccountType] =
    useState<ProviderPayoutAccountType>("UPI");
  const [upiId, setUpiId] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [financialSubmitting, setFinancialSubmitting] = useState(false);
  const [financialMessage, setFinancialMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const hydratePayoutForm = useCallback((account: ProviderPayoutAccount | null) => {
    if (!account) return;
    const nextType = account.account_type === "BANK" ? "BANK" : "UPI";
    setAccountType(nextType);
    setUpiId(account.upi_id || "");
    setAccountHolderName(account.account_holder_name || "");
    setBankAccountNumber(account.bank_account_number || "");
    setIfscCode(account.ifsc_code || "");
  }, []);

  useEffect(() => {
    const dashboard = getRoleDashboard(user?.role);
    if (dashboard !== "/dashboard") {
      router.replace(dashboard);
    }
  }, [router, user?.role]);

  useEffect(() => {
    let active = true;

    async function loadAnalytics() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const [platform, personal, reputation, providerFinancial, payoutAccounts] = await Promise.all([
          impactService.getPlatformImpact(),
          user.role === "user"
            ? impactService.getUserImpact(user.id)
            : Promise.resolve<ImpactSummary | null>(null),
          user.role === "provider"
            ? ratingService.getProviderRatings(user.id)
            : Promise.resolve<ProviderRatingSummary | null>(null),
          user.role === "provider"
            ? providerFinancialService.getSettlementSummary()
            : Promise.resolve<ProviderSettlementSummaryData | null>(null),
          user.role === "provider"
            ? providerFinancialService.getPayoutAccounts()
            : Promise.resolve(null),
        ]);

        if (!active) return;
        setPlatformImpact(platform);
        setUserImpact(personal);
        setProviderRatings(reputation);
        setFinancialSummary(providerFinancial);
        const activeAccount =
          payoutAccounts?.active_account || providerFinancial?.payout_account || null;
        setPayoutAccount(activeAccount);
        hydratePayoutForm(activeAccount);
      } catch (err) {
        if (active) setError(impactService.getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAnalytics();

    return () => {
      active = false;
    };
  }, [hydratePayoutForm, user?.id, user?.role]);

  const savePayoutAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (user?.role !== "provider") return;

    try {
      setFinancialSubmitting(true);
      setFinancialMessage("");
      setError("");
      const account = await providerFinancialService.savePayoutAccount(
        accountType === "UPI"
          ? {
              account_type: "UPI",
              upi_id: upiId,
            }
          : {
              account_type: "BANK",
              account_holder_name: accountHolderName,
              bank_account_number: bankAccountNumber,
              ifsc_code: ifscCode,
            }
      );
      const summary = await providerFinancialService.getSettlementSummary();
      setPayoutAccount(account);
      setFinancialSummary(summary);
      hydratePayoutForm(account);
      setFinancialMessage("Payment details saved. Verified: No");
    } catch (err) {
      setError(providerFinancialService.getErrorMessage(err));
    } finally {
      setFinancialSubmitting(false);
    }
  };

  const deactivatePayoutAccount = async () => {
    if (user?.role !== "provider") return;

    try {
      setFinancialSubmitting(true);
      setFinancialMessage("");
      setError("");
      await providerFinancialService.deactivatePayoutAccount();
      const summary = await providerFinancialService.getSettlementSummary();
      setPayoutAccount(null);
      setFinancialSummary(summary);
      setFinancialMessage("Active payout account deactivated.");
    } catch (err) {
      setError(providerFinancialService.getErrorMessage(err));
    } finally {
      setFinancialSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Impact, reputation, and platform rescue totals.
            </p>
          </div>
        </header>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {user && Number("restriction_level" in user ? user.restriction_level ?? 0 : 0) > 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">
              Restriction level {String("restriction_level" in user ? user.restriction_level : 0)}
            </p>
            <p className="mt-1">
              {displayRestrictionReason(
                "restriction_reason" in user ? user.restriction_reason : null
              )}
            </p>
            {"requires_reliability_deposit" in user &&
              user.requires_reliability_deposit && (
                <p className="mt-1">
                  Next eligible reservation may include a refundable reliability deposit of Rs.{" "}
                  {Number(user.reliability_deposit_amount ?? 0).toFixed(2)}.
                </p>
              )}
            {formatRestrictionDate("cooldown_until" in user ? user.cooldown_until : null) && (
              <p className="mt-1">
                Cooldown until{" "}
                {formatRestrictionDate("cooldown_until" in user ? user.cooldown_until : null)}
              </p>
            )}
            {formatRestrictionDate("banned_until" in user ? user.banned_until : null) && (
              <p className="mt-1">
                Temporarily unavailable until{" "}
                {formatRestrictionDate("banned_until" in user ? user.banned_until : null)}
              </p>
            )}
          </section>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading analytics...
          </div>
        ) : (
          <div className="space-y-6">
            {user?.role === "user" && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Your Impact
                </h2>
                <ImpactMetricGrid
                  columns="four"
                  metrics={[
                    {
                      label: "Total Pickups",
                      value: userImpact?.total_pickups,
                      detail: `${impactService.formatMetric(
                        userImpact?.self_pickups
                      )} self pickups`,
                    },
                    {
                      label: "Meals Saved",
                      value: userImpact?.total_meals_saved,
                      detail: "Reservation contribution",
                    },
                    {
                      label: "CO2 Saved",
                      value: userImpact?.estimated_co2_saved,
                      detail: "Estimated kg",
                      fractionDigits: 1,
                    },
                    {
                      label: "NGO Rescues",
                      value: userImpact?.ngo_meals_rescued,
                      detail: `${impactService.formatMetric(
                        userImpact?.ngo_pickups
                      )} completed pickups`,
                    },
                  ]}
                />
              </div>
            )}

            {user?.role === "provider" && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <h2 className="text-base font-semibold text-zinc-950">
                    Provider Reputation
                  </h2>
                  <ProviderReputation summary={providerRatings} />
                </div>

                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-zinc-950">
                        Payment Details
                      </h2>
                      <p className="mt-1 text-sm text-zinc-600">
                        {displayAccount(payoutAccount)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-zinc-500">
                        Verified: {payoutAccount?.is_verified ? "Yes" : "No"}
                      </p>
                    </div>
                    {payoutAccount?.is_active && (
                      <button
                        type="button"
                        onClick={deactivatePayoutAccount}
                        disabled={financialSubmitting}
                        className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 disabled:opacity-50"
                      >
                        Deactivate
                      </button>
                    )}
                  </div>

                  {financialMessage && (
                    <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {financialMessage}
                    </p>
                  )}

                  <form className="mt-4 space-y-4" onSubmit={savePayoutAccount}>
                    <div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-1">
                      {(["UPI", "BANK"] as ProviderPayoutAccountType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setAccountType(type)}
                          className={`rounded px-3 py-2 text-sm font-medium ${
                            accountType === type
                              ? "bg-zinc-950 text-white"
                              : "text-zinc-700"
                          }`}
                        >
                          {type === "UPI" ? "Add UPI" : "Add Bank Account"}
                        </button>
                      ))}
                    </div>

                    {accountType === "UPI" ? (
                      <label className="block text-sm">
                        <span className="font-medium text-zinc-700">UPI ID</span>
                        <input
                          value={upiId}
                          onChange={(event) => setUpiId(event.target.value)}
                          placeholder="name@upi"
                          className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                        />
                      </label>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="block text-sm">
                          <span className="font-medium text-zinc-700">
                            Account Holder
                          </span>
                          <input
                            value={accountHolderName}
                            onChange={(event) =>
                              setAccountHolderName(event.target.value)
                            }
                            className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="font-medium text-zinc-700">
                            Account Number
                          </span>
                          <input
                            value={bankAccountNumber}
                            onChange={(event) =>
                              setBankAccountNumber(event.target.value)
                            }
                            className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="font-medium text-zinc-700">IFSC</span>
                          <input
                            value={ifscCode}
                            onChange={(event) =>
                              setIfscCode(event.target.value.toUpperCase())
                            }
                            className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm uppercase text-zinc-950 outline-none focus:border-zinc-950"
                          />
                        </label>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={financialSubmitting}
                      className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {financialSubmitting ? "Saving..." : "Save Payment Details"}
                    </button>
                  </form>
                </section>

                <section className="space-y-3">
                  <h2 className="text-base font-semibold text-zinc-950">
                    Earnings
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-medium text-zinc-600">
                        Pending Earnings
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-zinc-950">
                        {formatCurrency(financialSummary?.earnings.pending)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-medium text-zinc-600">
                        Paid Earnings
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-zinc-950">
                        {formatCurrency(financialSummary?.earnings.paid)}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                    <div className="border-b border-zinc-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-zinc-950">
                        Settlement History
                      </h3>
                    </div>
                    {!financialSummary?.settlements.length ? (
                      <p className="p-4 text-sm text-zinc-600">
                        No provider settlements recorded yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-zinc-100 text-sm">
                          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                            <tr>
                              <th className="px-4 py-3">Date</th>
                              <th className="px-4 py-3">Amount</th>
                              <th className="px-4 py-3">Reference</th>
                              <th className="px-4 py-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {financialSummary.settlements.map((settlement) => (
                              <tr key={String(settlement.id)}>
                                <td className="px-4 py-3 text-zinc-700">
                                  {settlement.paid_at
                                    ? formatDateTime(settlement.paid_at)
                                    : formatDateTime(
                                        settlement.updated_at ||
                                          settlement.created_at ||
                                          ""
                                      )}
                                </td>
                                <td className="px-4 py-3 font-medium text-zinc-950">
                                  {formatCurrency(settlement.amount)}
                                </td>
                                <td className="px-4 py-3 text-zinc-700">
                                  {settlement.payment_reference || "-"}
                                </td>
                                <td className="px-4 py-3 text-zinc-700">
                                  {String(settlement.status).replace(/_/g, " ")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Platform Impact
              </h2>
              <ImpactMetricGrid
                columns="four"
                metrics={[
                  {
                    label: "Meals Saved",
                    value: platformImpact?.total_meals_saved,
                    detail: "Across completed pickups",
                  },
                  {
                    label: "Completed Pickups",
                    value: platformImpact?.total_pickups,
                    detail: "Platform-wide",
                  },
                  {
                    label: "CO2 Saved",
                    value: platformImpact?.estimated_co2_saved,
                    detail: "Estimated kg",
                    fractionDigits: 1,
                  },
                  {
                    label: "NGO Meals",
                    value: platformImpact?.ngo_meals_rescued,
                    detail: `${impactService.formatMetric(
                      platformImpact?.ngo_pickups
                    )} NGO pickups`,
                  },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
