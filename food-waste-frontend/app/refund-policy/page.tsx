import type { Metadata } from "next";
import {
  LegalPageShell,
  LegalSection,
  SimpleList,
  supportEmail,
} from "@/components/public/PublicSite";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy | FoodForAll",
  description:
    "Refund and cancellation policy for FoodForAll reservation payments, payment holds, failed payments, and Cashfree refunds.",
};

export default function RefundPolicyPage() {
  return (
    <LegalPageShell
      title="Refund & Cancellation Policy"
      description="This policy reflects the current FoodForAll reservation and Cashfree payment flow."
    >
      <LegalSection title="Reservation Payments">
        <SimpleList
          items={[
            "Paid user reservations are processed through Cashfree checkout.",
            "When a paid reservation starts, FoodForAll creates a payment order, stores payment references, and holds reserved stock while payment is pending.",
            "The default payment hold is 10 minutes unless the platform configuration changes.",
            "Free listings are intended for NGO rescue workflows and do not require the same user checkout flow.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Payment Failures And Expired Holds">
        <SimpleList
          items={[
            "If payment is not completed before the hold expires, the reservation is not confirmed.",
            "Expired or failed payment holds are reconciled by payment timeout and reconciliation workers.",
            "When a pending payment hold is cancelled or fails before confirmation, stock is restored where applicable and the payment state is marked failed.",
            "No refund is normally required for an unpaid failed hold because no successful payment was captured.",
          ]}
        />
      </LegalSection>

      <LegalSection title="User Cancellations">
        <SimpleList
          items={[
            "A pending unpaid reservation can be cancelled before payment confirmation.",
            "A paid self-pickup reservation can be cancelled only before the cancellation cutoff, currently 20 minutes before the pickup end time by default.",
            "If the cancellation window is closed, the reservation is no longer refundable through the normal user cancellation flow.",
            "When a paid eligible reservation is cancelled, FoodForAll marks the payment as refund pending and queues refund processing.",
          ]}
        />
      </LegalSection>

      <LegalSection title="NGO And Volunteer-Linked Cancellations">
        <SimpleList
          items={[
            "NGO reservations cannot be cancelled through the normal cancellation flow after a volunteer has started the task.",
            "When a cancellation is allowed, FoodForAll restores available stock where applicable and updates reservation, task, listing, payment, and notification state.",
            "Volunteer pickup or delivery failures may affect trust and operational records.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Refund Processing">
        <SimpleList
          items={[
            "Refunds are processed asynchronously through FoodForAll refund workers and Cashfree gateway reconciliation.",
            "A refund may show as refund pending, refunded, or refund failed depending on gateway state.",
            "FoodForAll does not promise instant refunds; final credit timing depends on Cashfree and the user's bank or payment method.",
            "If a refund fails, FoodForAll retains the refund failed state for review and reconciliation.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Reliability Deposits">
        <p>
          Some accounts may be asked to pay a refundable reliability deposit
          based on trust or restriction policy. The deposit can be refunded
          through the payment/refund workflow, but may be retained when the
          reservation lifecycle records a failure or policy reason that allows
          retention.
        </p>
      </LegalSection>

      <LegalSection title="Support">
        <p>
          For payment, cancellation, or refund questions, contact{" "}
          <a className="font-medium text-emerald-700" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
          . Please include the phone number used for login and any available
          reservation or order reference.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
