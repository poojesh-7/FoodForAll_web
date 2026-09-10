"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle } from "lucide-react";
import type { DbId } from "@shared/contracts/api-contracts";
import { adminService, type RefundCarryForwardResult } from "@/services/admin.service";

interface CarryForwardModalProps {
  settlementId: DbId;
  refundAmount: number | string;
  providerName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: RefundCarryForwardResult) => void;
}

function formatCurrency(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function CarryForwardModal({
  settlementId,
  refundAmount,
  providerName,
  isOpen,
  onClose,
  onSuccess,
}: CarryForwardModalProps) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const refundAmountNum = Number(refundAmount || 0);

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError("");

      const result = await adminService.applyRefundCarryForward(settlementId, {
        notes: notes.trim() || "Carry forward applied by admin",
      });

      toast.success(
        `Refund carry forward applied: ${formatCurrency(result.carryForwardAmount)}`
      );
      setNotes("");
      onSuccess(result);
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
            Apply Refund Carry Forward
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Recover this refund from future provider settlements
          </p>
        </div>

        <div className="space-y-4 px-6 py-4">
          {error && (
            <div className="flex gap-3 rounded-md border border-red-200 bg-red-50 p-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600" />
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}

          <div className="space-y-2 rounded-md bg-zinc-50 p-3">
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Provider:</span>
              <span className="font-medium text-zinc-950">{providerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Refund Amount:</span>
              <span className="font-medium text-red-600">
                {formatCurrency(refundAmountNum)}
              </span>
            </div>
            <div className="border-t border-zinc-200 pt-2 text-xs text-zinc-500">
              <p>
                The next eligible pending settlement will be reduced first. If the refund is larger,
                the remaining balance will continue across later settlements.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Admin Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for carry forward, additional context, etc."
              rows={3}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              disabled={loading}
            />
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Confirmation:</strong> Apply will recover up to {formatCurrency(refundAmountNum)} from
              future pending settlements for this provider. Each affected settlement will show its
              reduction and any remaining refund balance will stay available for the next settlement.
          </div>
        </div>

        <div className="flex gap-3 border-t border-zinc-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || refundAmountNum <= 0}
            className="flex-1 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {loading ? "Applying..." : "Apply Carry Forward"}
          </button>
        </div>
      </div>
    </div>
  );
}
