import { Suspense } from "react";
import PaymentResultView from "@/components/payments/PaymentResultView";

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<PaymentResultFallback />}>
      <PaymentResultView expected="success" />
    </Suspense>
  );
}

function PaymentResultFallback() {
  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-3xl rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
        Verifying payment...
      </div>
    </main>
  );
}
