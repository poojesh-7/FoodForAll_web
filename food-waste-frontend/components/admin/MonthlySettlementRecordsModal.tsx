"use client";

import { useCallback, useEffect, useState } from "react";
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

function settlementAmountLabel(record: AdminProviderSettlementRow) {
  const amount = Number(record.amount || 0);
  return formatCurrency(amount);
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
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [recordCount, setRecordCount] = useState(0);
  const [carryForwardModal, setCarryForwardModal] = useState<{
    isOpen: boolean;
    settlementId?: DbId;
    refundAmount?: number;
    providerName?: string;
  }>({ isOpen: false });

  const loadRecords = useCallback(async (pageNumber: number) => {
    try {
      setLoading(true);
      setError("");
      const result = await adminService.getAdminSettlementRecords({
        providerId,
        year,
        month,
        limit: 10,
        page: pageNumber,
      });

      setRecords(result.records);
      setPage(result.page);
      setPageCount(result.pageCount);
      setRecordCount(result.count);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
      toast.error("Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [month, providerId, year]);

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => {
      void loadRecords(1);
    });
  }, [isOpen, loadRecords]);

  const handleCarryForwardSuccess = async () => {
    await loadRecords(page);
    toast.success("Settlement data refreshed");
  };

  if (!isOpen) return null;

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
                  Showing {recordCount} records
                </p>
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
            ) : records.length === 0 ? (
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
                    {records.map((record) => {
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

            {!loading && pageCount > 0 ? (
              <div className="mt-4 flex items-center justify-between border-t border-zinc-200 pt-4">
                <p className="text-sm text-zinc-600">
                  Page {page} of {pageCount}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void loadRecords(page - 1)}
                    disabled={page <= 1}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadRecords(page + 1)}
                    disabled={page >= pageCount}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
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
