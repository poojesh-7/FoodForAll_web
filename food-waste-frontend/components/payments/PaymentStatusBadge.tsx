import {
  getPaymentStateLabel,
  getPaymentStateTone,
  type ReservationPaymentState,
} from "@/lib/payment-flow";

type PaymentStatusBadgeProps = {
  state: ReservationPaymentState;
};

const toneClasses: Record<ReturnType<typeof getPaymentStateTone>, string> = {
  success: "border-brand bg-brand-soft text-brand-hover",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-border bg-surface-muted text-text-secondary",
};

export default function PaymentStatusBadge({ state }: PaymentStatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${toneClasses[getPaymentStateTone(state)]}`}
    >
      {getPaymentStateLabel(state)}
    </span>
  );
}
