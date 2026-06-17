"use client";

import { AlertTriangle } from "lucide-react";
import type { ReservationCapacity } from "@shared/contracts/api-contracts";

type PricingBreakdownProps = {
  role: "user" | "ngo";
  foodAmount: number;
  depositAmount: number;
  totalAmount: number;
  requiresDeposit?: boolean;
  reservationCapacity?: ReservationCapacity;
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
  reservationCapacity,
  loading = false,
}: PricingBreakdownProps) {
  const showDeposit = requiresDeposit || depositAmount > 0;
  const showCapacity =
    reservationCapacity && Number.isFinite(reservationCapacity.maxActiveReservations);
  const showBulkDisabled =
    role === "ngo" && reservationCapacity?.bulkReservationEnabled === false;
  const capacityExhausted =
    reservationCapacity && reservationCapacity.remainingCapacity <= 0;

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

      {showCapacity && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          <p className="font-semibold text-zinc-950">
            {reservationCapacity.activeReservations} of{" "}
            {reservationCapacity.maxActiveReservations} active reservations used
          </p>
          {capacityExhausted && (
            <p className="mt-1">
              You have reached your active reservation limit. Complete or close an
              existing reservation before creating another.
            </p>
          )}
          {showBulkDisabled && !showDeposit && !capacityExhausted && (
            <p className="mt-1">
              Bulk reservations are temporarily disabled due to account reliability
              restrictions.
            </p>
          )}
        </div>
      )}

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
                {role === "ngo"
                  ? "Reservations currently require a refundable reliability deposit. Reserve and complete listings one at a time until restrictions are lifted."
                  : "Repeated missed pickups may increase future deposit requirements or trigger temporary restrictions."}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
