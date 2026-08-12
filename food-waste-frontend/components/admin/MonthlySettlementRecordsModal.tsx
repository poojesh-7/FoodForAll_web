"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { AdminProviderSettlementRow, DbId } from "@shared/contracts/api-contracts";
import { adminService } from "@/services/admin.service";
import { formatDateTimeOrFallback } from "@/lib/dateTime";

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

  useEffect(() => {
    if (!isOpen) return;

    const loadRecords = async () => {
      try {
        setLoading(true);
        setError("");
        // Fetch individual records for this provider and month
        const result = await adminService.getProviderSettlementConsole({
          providerId,
          status: "all",
          verificationStatus: "all",
          limit: 500,
        });

        // Filter by year/month in memory (frontend filtering for simplicity)
        const filtered = result.settlements.filter((s) => {
          const recordDate = new Date(
            s.paid_at || s.updated_at || s.created_at || ""
          );
          return (
            recordDate.getFullYear() === year &&
            recordDate.getMonth() + 1 === month
          );
        });

        setRecords(filtered);
      } catch (err) {
        setError(adminService.getErrorMessage(err));
        toast.error("Failed to load records");
      } finally {
        setLoading(false);
      }
    };

    void loadRecords();
  }, [isOpen, providerId, month, year]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-lg">
        <div className="sticky top-0 border-b border-zinc-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">
                Settlement Records - {monthLabel}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Showing {records.length} records
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
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {records.map((record) => (
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
                        {formatCurrency(record.amount)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {label(record.status)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {record.payment_reference || "-"}
                      </td>
                    </tr>
                  ))}
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
  );
}
