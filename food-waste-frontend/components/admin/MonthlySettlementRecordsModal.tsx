"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { AdminProviderSettlementRow, DbId } from "@shared/contracts/api-contracts";
import { adminService } from "@/services/admin.service";
import { formatDateTimeOrFallback } from "@/lib/dateTime";
import { CarryForwardModal } from "./CarryForwardModal";

interface MonthlySettlementRecordsModalProps {
  providerId: DbId;
  month: number; // 1-12
  year: number;
  monthLabel: string;
  isOpen: boolean;
  onClose: () => void;
}

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

function effectiveSettlementAmount(record: AdminProviderSettlementRow) {
  if (record.net_payable !== undefined) return Number(record.net_payable || 0);
  return Math.max(
    0,
    Number(record.amount || 0) - Number(record.refund_deduction_amount || 0),
  );
}

function settlementAmountLabel(record: AdminProviderSettlementRow) {
  const amount = Number(record.amount || 0);
  return formatCurrency(amount);
}

function settlementRunRecord(run: {
  id: DbId;
  provider_id: DbId;
  settled_at: string;
  paid_amount: number | string;
  pending_amount_before: number | string;
  pending_amount_after: number | string;
  carry_forward_reduced_amount: number | string;
  payment_reference?: string | null;
  notes?: string | null;
}) {
  return {
    id: run.id,
    provider_id: run.provider_id,
    reservation_id: run.id,
    amount_due: 0,
    pending_settlements: 0,
    payout_account: null,
    payment_session_id: `settlement-run:${run.id}`,
    amount: run.paid_amount,
    paid_amount: run.paid_amount,
    currency: "INR",
    status: "settled",
    raw_status: "settled",
    paid_at: run.settled_at,
    payment_reference: run.payment_reference,
    notes: run.notes,
    settlement_run: true,
    pending_amount_before: run.pending_amount_before,
    pending_amount_after: run.pending_amount_after,
    carry_forward_reduced_amount: run.carry_forward_reduced_amount,
    display_status: "Settled",
    created_at: run.settled_at,
    updated_at: run.settled_at,
  } as AdminProviderSettlementRow;
}

export function MonthlySettlementRecordsModal({
  providerId,
  month,
  year,
  monthLabel,
  isOpen,
  onClose,
}: MonthlySettlementRecordsModalProps) {
  const [records, setRecords] = useState<AdminProviderSettlementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [carryForwardModal, setCarryForwardModal] = useState<{
    isOpen: boolean;
    settlementId?: DbId;
    refundAmount?: number;
    providerName?: string;
  }>({ isOpen: false });

  useEffect(() => {
    if (!isOpen) return;

    const loadRecords = async () => {
      try {
        setLoading(true);
        setError("");
        // Fetch individual records for this provider and month
        const [result, runsResult] = await Promise.all([
          adminService.getProviderSettlementConsole({
            providerId,
            status: "all",
            verificationStatus: "all",
            limit: 500,
          }),
          adminService.getSettlementRuns({ providerId, year, month, status: "settled", limit: 500 }),
        ]);

        // Filter by year/month in memory (frontend filtering for simplicity)
        const filtered = result.settlements.filter((s) => {
          const recordDate = new Date(s.created_at || s.updated_at || "");
          return (
            recordDate.getFullYear() === year &&
            recordDate.getMonth() + 1 === month
          );
        });

        setRecords([...filtered, ...runsResult.records.map(settlementRunRecord)]);
      } catch (err) {
        setError(adminService.getErrorMessage(err));
        toast.error("Failed to load records");
      } finally {
        setLoading(false);
      }
    };

    void loadRecords();
  }, [isOpen, providerId, month, year]);

  const handleCarryForwardSuccess = async () => {
    // Reload records after carry forward
    try {
      const [result, runsResult] = await Promise.all([
        adminService.getProviderSettlementConsole({
          providerId,
          status: "all",
          verificationStatus: "all",
          limit: 500,
        }),
        adminService.getSettlementRuns({ providerId, year, month, status: "settled", limit: 500 }),
      ]);

      const filtered = result.settlements.filter((s) => {
          const recordDate = new Date(s.created_at || s.updated_at || "");
        return (
          recordDate.getFullYear() === year &&
          recordDate.getMonth() + 1 === month
        );
      });

      setRecords([...filtered, ...runsResult.records.map(settlementRunRecord)]);
      toast.success("Settlement data refreshed");
    } catch (err) {
      toast.error("Failed to refresh after carry forward");
    }
  };

  if (!isOpen) return null;

  const visibleRecords = records.filter((record) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "settled") return Boolean(record.settlement_run);
    if (statusFilter === "refunded") return Number(record.refund_amount || 0) > 0;
    return String(record.status || "").toLowerCase() === statusFilter;
  });

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-lg bg-white shadow-lg">
          <div className="sticky top-0 border-b border-zinc-200 bg-white px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  Settlement Records - {monthLabel}
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Showing {visibleRecords.length} records
                </p>
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-zinc-700">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="settled">Settled</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </label>
              </div>
              <button
                onClick={onClose}
                className="text-zinc-500 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="text-center py-8">
                <p className="text-zinc-600">Loading records...</p>
              </div>
            ) : visibleRecords.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-zinc-600">
                  No settlement records found for {monthLabel}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-100 text-sm">
                  <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Refund</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {visibleRecords.map((record) => {
                      const refundAmount = Number(record.refund_amount || 0);
                      const carriedForwardAmount = Number(
                        record.manual_carry_forward_amount || 0,
                      ) + Number(record.recorded_carry_forward_amount || 0);
                      const hasRefund = refundAmount > 0;
                      const isFullyCarriedForward =
                        hasRefund &&
                        (carriedForwardAmount >= refundAmount ||
                          Boolean(record.manual_carry_forward_applied_at));
                      return (
                        <tr key={record.id}>
                          <td className="px-4 py-3 text-zinc-700">
                            {formatDateTimeOrFallback(
                              record.paid_at ||
                                record.updated_at ||
                                record.created_at ||
                                null
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium text-zinc-950">
                            {settlementAmountLabel(record)}
                            {carriedForwardAmount > 0 ? (
                              <p className="mt-1 max-w-64 text-xs font-normal text-amber-700">
                                Carry-forward remaining: {formatCurrency(carriedForwardAmount)}
                              </p>
                            ) : null}
                            {record.refund_note ? (
                              <p className="mt-1 max-w-64 text-xs font-normal text-amber-700">
                                {record.refund_note}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {hasRefund ? (
                              <span className="font-medium text-red-600">
                                {formatCurrency(refundAmount)}
                              </span>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-zinc-700">
                            {record.refund_amount && Number(record.refund_amount) > 0
                              ? record.display_status || label(record.status)
                              : label(record.status)}
                          </td>
                          <td className="px-4 py-3 text-zinc-700">
                            {record.settlement_run ? (
                              <div>
                                <p>{record.payment_reference || "-"}</p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  Paid {formatCurrency(record.amount)} | Reduced {formatCurrency(record.carry_forward_reduced_amount)} | Pending before {formatCurrency(record.pending_amount_before)}
                                </p>
                              </div>
                            ) : record.payment_reference || "-"}
                          </td>
                          <td className="px-4 py-3">
                            {hasRefund ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setCarryForwardModal({
                                    isOpen: true,
                                    settlementId: record.id,
                                    refundAmount,
                                    providerName: record.provider_name || "Provider",
                                  })
                                }
                                disabled={isFullyCarriedForward}
                                className="inline-flex min-h-8 items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isFullyCarriedForward
                                  ? "Refund Recovery Applied"
                                  : "Carry Forward"}
                              </button>
                            ) : (
                              <span className="text-xs text-zinc-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-4 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <CarryForwardModal
        isOpen={carryForwardModal.isOpen}
        settlementId={carryForwardModal.settlementId || ""}
        refundAmount={carryForwardModal.refundAmount || 0}
        providerName={carryForwardModal.providerName || "Provider"}
        onClose={() => setCarryForwardModal({ isOpen: false })}
        onSuccess={handleCarryForwardSuccess}
      />
    </>
  );
}
