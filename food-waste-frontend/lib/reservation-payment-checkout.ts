import { openCashfreeCheckout } from "@/lib/cashfree";
import { savePaymentSession, type StoredPaymentSession } from "@/lib/payment-flow";

export async function openReservationPaymentCheckout(
  session: Omit<StoredPaymentSession, "createdAt">
) {
  savePaymentSession(session);

  return openCashfreeCheckout({
    paymentSessionId: session.paymentSessionId,
  });
}
