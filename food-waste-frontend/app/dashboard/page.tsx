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

function payoutAccountTypeLabel(account: ProviderPayoutAccount | null) {
  if (!account) return "None";
  return account.account_type === "BANK" ? "Bank" : "UPI";
}

function payoutVerificationStatus(account: ProviderPayoutAccount | null) {
  if (!account) return "No account";
  if (account.change_request_status === "replacement_pending") {
    return "Replacement Pending";
  }
  if (account.verification_status === "verified" || account.is_verified) {
    return "Verified";
  }
  if (account.verification_status === "rejected") {
    return "Rejected";
  }
  return "Pending Review";
}

function payoutVerificationBanner(account: ProviderPayoutAccount | null) {
  if (!account) {
    return {
      tone: "neutral",
      message: "Add payout details to receive settlements once verified.",
    };
  }
  if (account.change_request_status === "pending") {
    return {
      tone: "warning",
      message: "Change request pending review. You cannot upload a replacement until an admin approves the request.",
    };
  }
  if (account.change_request_status === "replacement_pending") {
    return {
      tone: "warning",
      message:
        "Your payout account is temporarily suspended. Upload a replacement payout account to resume settlements.",
    };
  }
  if (account.change_request_status === "approved") {
    return {
      tone: "success",
      message: "Your change request is approved. Upload replacement payout account details now.",
    };
  }
  if (account.change_request_status === "replacement_pending") {
    return {
      tone: "warning",
      message:
        "Your payout account is temporarily suspended. Upload a replacement payout account to resume settlements.",
    };
  }
  if (account.verification_status === "verified" || account.is_verified) {
    return {
      tone: "success",
      message:
        "Your payout account is verified and eligible for settlements.",
    };
  }
  if (account.verification_status === "rejected") {
    return {
      tone: "danger",
      message:
        "Your payout account was rejected. Please update the details and resubmit.",
    };
  }
  return {
    tone: "warning",
    message:
      "Your payout account is awaiting admin verification. Settlements cannot be paid until verification is completed.",
  };
}

const CHANGE_REQUEST_REASONS = [
  "Changed bank account",
  "Changed UPI",
  "Account closed",
  "Incorrect details",
  "Security concern",
  "Other",
] as const;

type ChangeRequestReason = (typeof CHANGE_REQUEST_REASONS)[number];

function payoutAccountStatusBadge(account: ProviderPayoutAccount | null) {
  const base =
    "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide";

  if (!account) {
    return (
      <span className={`${base} bg-zinc-100 text-zinc-700`}>
        No Account
      </span>
    );
  }

  if (account.change_request_status === "pending") {
    return (
      <span className={`${base} bg-amber-100 text-amber-800`}>
        Pending Review
      </span>
    );
  }

  if (account.change_request_status === "rejected") {
    return (
      <span className={`${base} bg-rose-100 text-rose-800`}>
        Rejected
      </span>
    );
  }

  if (account.change_request_status === "replacement_pending") {
    return (
      <span className={`${base} bg-amber-100 text-amber-800`}>
        Replacement Pending
      </span>
    );
  }

  if (account.change_request_status === "approved") {
    return (
      <span className={`${base} bg-emerald-100 text-emerald-800`}>
        Change Approved
      </span>
    );
  }
  if (account.change_request_status === "replacement_pending") {
    return (
      <span className={`${base} bg-amber-100 text-amber-800`}>
        Replacement Pending
      </span>
    );
  }

  if (account.verification_status === "verified" || account.is_verified) {
    return (
      <span className={`${base} bg-emerald-100 text-emerald-800`}>
        Verified
      </span>
    );
  }

  return (
    <span className={`${base} bg-amber-100 text-amber-800`}>
      Verification Pending
    </span>
  );
}

function settlementStatusChip(status: string) {
  const normalized = String(status || "").toLowerCase();
  const base = "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide";

  if (normalized === "paid") {
    return <span className={`${base} bg-emerald-100 text-emerald-800`}>Paid</span>;
  }
  if (normalized === "failed" || normalized === "cancelled") {
    return <span className={`${base} bg-rose-100 text-rose-800`}>Failed</span>;
  }
  return <span className={`${base} bg-amber-100 text-amber-800`}>Pending</span>;
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
  const [changeModalOpen, setChangeModalOpen] = useState(false);
  const [changeRequestReason, setChangeRequestReason] = useState<ChangeRequestReason>(
    "Changed bank account"
  );
  const [changeRequestOtherReason, setChangeRequestOtherReason] = useState("");
  const [changeRequestSubmitting, setChangeRequestSubmitting] = useState(false);
  const [changeRequestError, setChangeRequestError] = useState("");

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
    if (!active) return;
    
    return () => {
      active = false;
    };
  }, [hydratePayoutForm, user?.id, user?.role]);

  const isVerifiedAccount = Boolean(
    payoutAccount &&
      (payoutAccount.verification_status === "verified" || payoutAccount.is_verified)
  );
  const isChangePending = payoutAccount?.change_request_status === "pending";
  const isChangeApproved = payoutAccount?.change_request_status === "approved";
  const isReplacementPending =
    payoutAccount?.change_request_status === "replacement_pending";
  const isChangeRejected = payoutAccount?.change_request_status === "rejected";
  const showPayoutEditor = !payoutAccount || isChangeApproved || isReplacementPending;
  const showRequestChangeButton =
    isVerifiedAccount && !isChangePending && !isChangeApproved && !isReplacementPending;

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
      setFinancialMessage(
        isChangeApproved
          ? "Replacement uploaded. Verification pending."
          : "Payment details saved. Verified: No"
      );
    } catch (err) {
      setError(providerFinancialService.getErrorMessage(err));
    } finally {
      setFinancialSubmitting(false);
    }
  };

  const closeChangeRequestModal = () => {
    setChangeModalOpen(false);
    setChangeRequestError("");
    setChangeRequestOtherReason("");
    setChangeRequestReason("Changed bank account");
  };

  const submitChangeRequest = async () => {
    if (user?.role !== "provider") return;

    const reason =
      changeRequestReason === "Other"
        ? changeRequestOtherReason.trim()
        : changeRequestReason;

    if (!reason) {
      setChangeRequestError("Please provide a reason for the change request.");
      return;
    }

    try {
      setChangeRequestSubmitting(true);
      setError("");
      setChangeRequestError("");
      setFinancialMessage("");

      const account = await providerFinancialService.requestPayoutAccountChange({
        reason,
      });
      const summary = await providerFinancialService.getSettlementSummary();
      setPayoutAccount(account);
      setFinancialSummary(summary);
      hydratePayoutForm(account);
      setFinancialMessage("Change request submitted and is pending review.");
      closeChangeRequestModal();
    } catch (err) {
      setChangeRequestError(providerFinancialService.getErrorMessage(err));
    } finally {
      setChangeRequestSubmitting(false);
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

                <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                    <div className="space-y-3">
                      <h2 className="text-base font-semibold text-zinc-950">
                        Payout Account
                      </h2>
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <p className="text-xs uppercase text-zinc-500">Type</p>
                            <p className="mt-1 text-sm font-semibold text-zinc-950">
                              {payoutAccountTypeLabel(payoutAccount)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase text-zinc-500">Account</p>
                            <p className="mt-1 text-sm text-zinc-950">
                              {displayAccount(payoutAccount)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase text-zinc-500">Status</p>
                            <p className="mt-1 text-sm font-semibold text-zinc-950">
                              {payoutVerificationStatus(payoutAccount)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <p className="text-xs uppercase text-zinc-500">Last Updated</p>
                            <p className="mt-1 text-sm text-zinc-700">
                              {payoutAccount?.updated_at
                                ? formatDateTime(payoutAccount.updated_at)
                                : "-"}
                            </p>
                          </div>
                          {payoutAccount?.verified_at ? (
                            <div>
                              <p className="text-xs uppercase text-zinc-500">Verified At</p>
                              <p className="mt-1 text-sm text-zinc-700">
                                {formatDateTime(payoutAccount.verified_at)}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <p className="text-sm font-semibold text-zinc-950">Verification Status</p>
                      <p className="mt-2 text-sm text-zinc-700">
                        {payoutVerificationBanner(payoutAccount).message}
                      </p>
                    </div>
                  </div>

                  {financialMessage && (
                    <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {financialMessage}
                    </p>
                  )}

                  <div className="mt-4">{payoutAccountStatusBadge(payoutAccount)}</div>

                  {showRequestChangeButton && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setChangeModalOpen(true)}
                        className="inline-flex min-h-10 items-center justify-center rounded-md bg-amber-500 px-4 text-sm font-medium text-white hover:bg-amber-600"
                      >
                        Request Account Change
                      </button>
                    </div>
                  )}

                  {showPayoutEditor ? (
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
                  ) : (
                    <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                      {isChangePending ? (
                        <div>
                          <p className="font-semibold text-zinc-950">
                            Change Request Pending Review
                          </p>
                          <p className="mt-2">
                            <span className="font-medium">Reason:</span>{" "}
                            {payoutAccount?.change_request_reason || "-"}
                          </p>
                          <p className="mt-2">
                            <span className="font-medium">Requested At:</span>{" "}
                            {payoutAccount?.change_requested_at
                              ? formatDateTime(payoutAccount.change_requested_at)
                              : "-"}
                          </p>
                        </div>
                      ) : isChangeRejected ? (
                        <div>
                          <p className="font-semibold text-zinc-950">
                            Change Request Rejected
                          </p>
                          <p className="mt-2">
                            <span className="font-medium">Reason:</span>{" "}
                            {payoutAccount?.change_request_reason || "-"}
                          </p>
                          <p className="mt-2">
                            <span className="font-medium">Rejected By:</span>{" "}
                            {payoutAccount?.change_review_notes || "-"}
                          </p>
                          <p className="mt-2">
                            <button
                              type="button"
                              onClick={() => setChangeModalOpen(true)}
                              className="inline-flex min-h-10 items-center justify-center rounded-md bg-amber-500 px-4 text-sm font-medium text-white hover:bg-amber-600"
                            >
                              Request Account Change
                            </button>
                          </p>
                        </div>
                      ) : isVerifiedAccount ? (
                        <div>
                          <p className="font-semibold text-zinc-950">
                            Verified payout account is locked for direct edits.
                          </p>
                          <p className="mt-2 text-zinc-700">
                            Request an account change if you need a new payout route.
                          </p>
                        </div>
                      ) : (
                        <p className="text-zinc-700">
                          No payout account available for editing.
                        </p>
                      )}
                    </div>
                  )}
                </section>

                {changeModalOpen ? (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
                    <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
                      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">
                            Request Payout Account Change
                          </h2>
                          <p className="mt-1 text-sm text-zinc-600">
                            Submit a change request for the admin team to review.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={closeChangeRequestModal}
                          className="text-zinc-500 transition hover:text-zinc-900"
                        >
                          Close
                        </button>
                      </div>
                      <div className="space-y-4 p-5">
                        <div>
                          <p className="text-sm font-medium text-zinc-700">
                            Reason for change
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {CHANGE_REQUEST_REASONS.map((reason) => (
                              <button
                                key={reason}
                                type="button"
                                onClick={() => setChangeRequestReason(reason)}
                                className={`rounded-2xl border px-4 py-3 text-left text-sm font-medium ${
                                  changeRequestReason === reason
                                    ? "border-amber-500 bg-amber-50 text-zinc-950"
                                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                                }`}
                              >
                                {reason}
                              </button>
                            ))}
                          </div>
                        </div>
                        {changeRequestReason === "Other" && (
                          <label className="block text-sm">
                            <span className="font-medium text-zinc-700">
                              Other reason
                            </span>
                            <textarea
                              value={changeRequestOtherReason}
                              onChange={(event) => setChangeRequestOtherReason(event.target.value)}
                              placeholder="Describe why you need to change your payout account"
                              rows={4}
                              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                            />
                          </label>
                        )}
                        {changeRequestError ? (
                          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            {changeRequestError}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={closeChangeRequestModal}
                            className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={submitChangeRequest}
                            disabled={changeRequestSubmitting}
                            className="inline-flex min-h-10 items-center justify-center rounded-md bg-amber-500 px-4 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                          >
                            {changeRequestSubmitting ? "Submitting..." : "Submit Request"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <section className="space-y-3">
                  <h2 className="text-base font-semibold text-zinc-950">
                    Earnings
                  </h2>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-medium text-zinc-600">
                        Pending Earnings
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-zinc-950">
                        {formatCurrency(financialSummary?.earnings.pending)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-medium text-zinc-600">
                        Paid Earnings
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-zinc-950">
                        {formatCurrency(financialSummary?.earnings.paid)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-medium text-zinc-600">
                        Lifetime Earnings
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-zinc-950">
                        {formatCurrency(
                          (Number(financialSummary?.earnings.pending || 0) || 0) +
                            (Number(financialSummary?.earnings.paid || 0) || 0)
                        )}
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
                                <td className="px-4 py-3">
                                  {settlementStatusChip(settlement.status)}
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
