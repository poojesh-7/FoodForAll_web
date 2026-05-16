"use client";

import { AlertTriangle } from "lucide-react";

type PricingBreakdownProps = {
  role: "user" | "ngo";
  foodAmount: number;
  depositAmount: number;
  totalAmount: number;
  requiresDeposit?: boolean;
  loading?: boolean;
};

function formatMoney(value: number) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

export default function PricingBreakdown({
  role,
  foodAmount,
  depositAmount,
  totalAmount,
  requiresDeposit = depositAmount > 0,
  loading = false,
}: PricingBreakdownProps) {
  const showDeposit = requiresDeposit || depositAmount > 0;

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-600">Food Cost</span>
          <span className="font-semibold text-zinc-950">
            {loading ? "Checking..." : formatMoney(foodAmount)}
          </span>
        </div>
        {showDeposit && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-600">Reliability Deposit</span>
            <span className="font-semibold text-amber-800">
              {formatMoney(depositAmount)} refundable
            </span>
          </div>
        )}
        <div className="border-t border-zinc-200 pt-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-zinc-950">Total Payable</span>
            <span className="text-lg font-semibold text-zinc-950">
              {loading ? "Checking..." : formatMoney(totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {showDeposit && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold">
                {role === "ngo"
                  ? "Your NGO currently requires a refundable operational deposit."
                  : "You currently have a refundable reliability deposit."}
              </p>
              <p>
                {role === "ngo"
                  ? "Successful rescue completion refunds this amount automatically."
                  : "Complete this pickup successfully to receive the deposit refund."}
              </p>
              <p className="text-xs leading-5">
                Repeated missed pickups may increase future deposit requirements or
                trigger temporary restrictions.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
