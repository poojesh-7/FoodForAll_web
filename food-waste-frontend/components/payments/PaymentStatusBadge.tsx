import {
  getPaymentStateLabel,
  getPaymentStateTone,
  type ReservationPaymentState,
} from "@/lib/payment-flow";

type PaymentStatusBadgeProps = {
  state: ReservationPaymentState;
};

const toneClasses: Record<ReturnType<typeof getPaymentStateTone>, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
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
