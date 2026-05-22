"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { DbId } from "@backend/contracts/api-contracts";

type ReservationCancelModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  reservationType?: "user" | "ngo";
  reservationId?: DbId | null;
  paymentPending?: boolean;
};

export default function ReservationCancelModal({
  open,
  onClose,
  onConfirm,
  loading = false,
  reservationType = "user",
  reservationId,
  paymentPending = false,
}: ReservationCancelModalProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loading, onClose, open]);

  const reservationLabel =
    reservationType === "ngo" ? "NGO reservation" : "reservation";
  const displayReservationId =
    reservationId === null || reservationId === undefined
      ? null
      : `RES-${String(reservationId).replace(/-/g, "").slice(-4).toUpperCase()}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/45 px-4 py-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onMouseDown={() => {
            if (!loading) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reservation-cancel-title"
            aria-describedby="reservation-cancel-description"
            className="w-full max-w-lg overflow-hidden rounded-lg border border-red-100 bg-white shadow-2xl"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2
                    id="reservation-cancel-title"
                    className="text-lg font-semibold text-zinc-950"
                  >
                    {paymentPending ? "Cancel Payment Hold?" : "Cancel Reservation?"}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {displayReservationId
                      ? `${displayReservationId} - ${reservationLabel}`
                      : `Confirm cancellation for this ${reservationLabel}.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 disabled:opacity-50"
                aria-label="Close cancel reservation confirmation"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <p
                id="reservation-cancel-description"
                className="text-sm leading-6 text-zinc-700"
              >
                {paymentPending
                  ? "Cancelling this payment hold releases the temporarily reserved food quantity so you can reserve again."
                  : "Cancelling this reservation will block reserving this listing again for this reservation lifecycle."}
              </p>

              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
                <p className="font-semibold text-red-950">
                  {paymentPending
                    ? "Payment hold cancellation effects"
                    : "Important cancellation effects"}
                </p>
                {paymentPending ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>The pending Cashfree session is invalidated locally.</li>
                    <li>Reserved stock is restored atomically.</li>
                    <li>You can retry this listing after cancellation completes.</li>
                  </ul>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>
                      Reliability deposits may not be refunded depending on
                      workflow state.
                    </li>
                    <li>
                      Volunteer or provider operations may already be active.
                    </li>
                    <li>This action cannot be instantly reversed.</li>
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                {paymentPending ? "Keep Hold" : "Keep Reservation"}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
              >
                {loading && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {loading
                  ? "Cancelling..."
                  : paymentPending
                    ? "Cancel Hold"
                    : "Cancel Reservation"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
