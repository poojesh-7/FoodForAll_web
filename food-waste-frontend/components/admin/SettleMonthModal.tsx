"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { DbId } from "@shared/contracts/api-contracts";
import { adminService } from "@/services/admin.service";

interface SettleMonthModalProps {
  providerId: DbId;
  providerName: string;
  month: number; // 1-12
  year: number;
  monthLabel: string;
  recordCount: number;
  totalAmount: number | string;
  uncarriedRefundAmount?: number | string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function formatCurrency(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function SettleMonthModal({
  providerId,
  providerName,
  month,
  year,
  monthLabel,
  recordCount,
  totalAmount,
  uncarriedRefundAmount = 0,
  isOpen,
  onClose,
  onSuccess,
}: SettleMonthModalProps) {
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [cutoffDate, setCutoffDate] = useState("");
  const [preview, setPreview] = useState({
    recordCount,
    totalAmount: Number(totalAmount),
    uncarriedRefundAmount: Number(uncarriedRefundAmount),
  });

  const loadPreview = useCallback(async (selectedDate: string) => {
    if (!selectedDate) return;

    try {
      setPreviewLoading(true);
      const result = await adminService.getMonthlySettlementConsole({
        status: "all",
        providerId,
        year,
        month,
        cutoffDate: selectedDate,
        limit: 1,
      });
      const row = result.monthly_settlements[0];
      setPreview({
        recordCount: row?.record_count || 0,
        totalAmount: Number(row?.eligible_payable_amount || 0),
        uncarriedRefundAmount: Number(row?.uncarried_refund_amount || 0),
      });
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [month, providerId, year]);

  useEffect(() => {
    if (!isOpen) return;
    const today = new Date();
    const todayValue = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    setCutoffDate(todayValue);
    setPreview({
      recordCount,
      totalAmount: Number(totalAmount),
      uncarriedRefundAmount: Number(uncarriedRefundAmount),
    });
    void loadPreview(todayValue);
  }, [isOpen, loadPreview, recordCount, totalAmount, uncarriedRefundAmount]);

  const handleSubmit = async () => {
    if (!reference.trim()) {
      setError("Payment reference is required");
      return;
    }

    if (Number(preview.uncarriedRefundAmount || 0) > 0) {
      setError(
        "Pending refunded records must be carried forward before settling this month.",
      );
      return;
    }

    try {
      setLoading(true);
      setError("");

      await adminService.settleMonth(providerId, year, month, {
        paid_amount: Number(preview.totalAmount),
        cutoff_date: cutoffDate,
        payment_reference: reference.trim(),
        notes: notes.trim(),
      });

      toast.success(
        `Settled ${preview.recordCount} records for ${monthLabel}`
      );
      setReference("");
      setNotes("");
      onSuccess();
      onClose();
    } catch (err) {
      const message = adminService.getErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white shadow-lg">
        <div className="border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">
            Settle Monthly Settlement
          </h2>
        </div>

        <div className="space-y-4 px-6 py-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Pay records up to
            </label>
            <input
              type="date"
              value={cutoffDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => {
                setCutoffDate(event.target.value);
                void loadPreview(event.target.value);
              }}
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              disabled={loading || previewLoading}
            />
          </div>

          <div className="space-y-2 rounded-md bg-zinc-50 p-3">
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Provider:</span>
              <span className="font-medium text-zinc-950">{providerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Month:</span>
              <span className="font-medium text-zinc-950">{monthLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Records:</span>
              <span className="font-medium text-zinc-950">{preview.recordCount}</span>
            </div>
            <div className="border-t border-zinc-200 pt-2 flex justify-between">
              <span className="text-sm font-medium text-zinc-700">
                Total Payable:
              </span>
              <span className="text-lg font-semibold text-zinc-950">
                {previewLoading ? "Calculating..." : formatCurrency(preview.totalAmount)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Payment Reference / UTR *
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g., UTR123456789"
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this settlement"
              className="mt-1 min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              disabled={loading}
            />
          </div>
        </div>

        <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || previewLoading || !reference.trim() || !cutoffDate}
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Settling..." : "Mark as Paid"}
          </button>
        </div>
      </div>
    </div>
  );
}
