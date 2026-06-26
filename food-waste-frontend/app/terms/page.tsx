import type { Metadata } from "next";
import {
  businessName,
  LegalPageShell,
  LegalSection,
  SimpleList,
  supportEmail,
} from "@/components/public/PublicSite";

export const metadata: Metadata = {
  title: "Terms & Conditions | FoodForAll",
  description:
    "Terms and Conditions for FoodForAll users, NGOs, providers, volunteers, and admins.",
};

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms & Conditions"
      description="These terms describe the responsibilities of people and organizations using FoodForAll for food rescue, reservations, provider onboarding, volunteer operations, trust, and governance workflows."
    >
      <LegalSection title="Platform Purpose">
        <p>
          {businessName} is a technology platform that connects users, NGOs, verified providers, and volunteers so surplus food can be listed, reserved, picked up, delivered, and tracked responsibly. FoodForAll facilitates coordination and operational workflows but does not manufacture, prepare, package, store, or independently certify the condition, quality, or safety of food items listed by providers. Providers remain responsible for compliance with applicable food-safety and regulatory requirements.
        </p>
      </LegalSection>

      <LegalSection title="Account Responsibilities">
        <SimpleList
          items={[
            "Use your own Google account for authentication and keep account access secure.",
            "Provide and maintain an accurate phone number for provider contact, NGO contact, volunteer coordination, reservation communication, support, compliance, account recovery, and future phone verification support.",
            "Provide accurate role, profile, organization, location, and verification information.",
            "Complete required role selection, profile completion, and role-specific onboarding before using protected platform workflows.",
            "Do not misuse OTP, reservation, payment, volunteer, provider, NGO, notification, reporting, or compliance workflows.",
            "Do not impersonate another person or organization.",
            "Tell FoodForAll about safety, payment, account, or policy concerns through support or in-app reporting where available.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Acceptable Use">
        <SimpleList
          items={[
            "Use FoodForAll only for lawful food rescue, reservation, provider, NGO, volunteer, support, and compliance purposes.",
            "Do not submit false verification details, unsafe listings, abusive reports, fraudulent payment activity, or misleading pickup information.",
            "Do not interfere with queues, notifications, realtime updates, governance workflows, or another account's access.",
            "Do not use platform information to harass, exploit, or endanger users, NGOs, providers, volunteers, admins, or communities.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Users">
        <SimpleList
          items={[
            "Users may reserve eligible available food listings and must complete required payment steps through the platform checkout.",
            "Users are responsible for arriving during pickup windows and following pickup instructions.",
            "Repeated cancellations, failed pickups, abuse, or policy violations may affect trust score, deposits, restrictions, or account access.",
            "Users must not resell, misuse, or misrepresent rescued food.",
          ]}
        />
      </LegalSection>

      <LegalSection title="NGOs">
        <SimpleList
          items={[
            "NGOs must provide accurate organization registration and service-area information.",
            "NGOs are responsible for coordinating community distribution safely and responsibly.",
            "NGOs must manage volunteer requests, rescue activity, and distribution decisions in good faith.",
            "NGO access may depend on verification status and compliance review.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Providers">
        <SimpleList
          items={[
            "Providers must submit accurate restaurant or food-provider details, including FSSAI information where required.",
            "Providers are responsible for food quality, safety, lawful sourcing, packaging, pickup readiness, and accurate listing information.",
            "Providers must list only food that can be responsibly shared within the stated pickup window.",
            "Provider reports, moderation cases, verification status, and governance actions may affect platform access.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Provider Payout Eligibility">
        <p>
          Providers receive settlements only after payout account submission,
          payout verification, and settlement approval.
        </p>
      </LegalSection>

      <LegalSection title="Payout Verification">
        <p>
          The platform may verify payout information before settlements are released.
        </p>
      </LegalSection>

      <LegalSection title="Payout Account Changes">
        <SimpleList
          items={[
            "Verified payout accounts cannot be freely replaced.",
            "Replacement may require a provider request, administrative approval, and re-verification.",
            "During this process, settlements may be temporarily suspended.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Manual Settlements">
        <p>
          The platform currently performs manual provider settlements. Future
          automated settlement mechanisms may be introduced.
        </p>
      </LegalSection>

      <LegalSection title="Platform Fees">
        <SimpleList
          items={[
            "Platform commission applies to eligible provider transactions.",
            "Payment gateway fees may apply where applicable.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Refunds">
        <SimpleList
          items={[
            "Reservation refunds and cancellation refunds are handled through the platform and payment gateway reconciliation.",
            "Reliability deposit refunds may be returned or retained according to platform policy.",
          ]}
        />
      </LegalSection>

      <LegalSection title="User Responsibilities">
        <SimpleList
          items={[
            "Providers are responsible for submitting accurate payout information.",
            "Incorrect payout information may delay settlement processing.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Compliance">
        <p>
          The platform may request additional verification documents in the
          future if required by law or payment partners. This does not mean those
          documents are mandatory today unless already required by current
          workflows.
        </p>
      </LegalSection>

      <LegalSection title="Volunteers">
        <SimpleList
          items={[
            "Volunteers may request to join NGOs, respond to NGO requests, and assist with pickup or delivery tasks.",
            "Volunteers must only accept tasks they can reasonably complete and must follow task instructions.",
            "Volunteer activity may be recorded for operational, trust, safety, and audit purposes.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Admins">
        <SimpleList
          items={[
            "Admins may access operational, moderation, compliance, governance, trust, queue, payment-health, audit, and incident tools only for authorized platform purposes.",
            "Admin actions may be recorded in audit, operational, compliance, governance, and incident histories.",
            "Admins must not use privileged access for personal, unauthorized, or unrelated purposes.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Payments, Cancellations, And Refunds">
        <p>
          Paid user reservations use Cashfree checkout. Payment holds,
          cancellation windows, refund pending states, refund success, and
          refund failure states are handled by FoodForAll and gateway
          reconciliation. The separate Refund & Cancellation Policy explains the
          current behavior in more detail.
        </p>
      </LegalSection>

      <LegalSection title="Trust, Governance, And Compliance Actions">
        <SimpleList
          items={[
            "FoodForAll may use trust scoring, cooldowns, deposits, restrictions, moderation workflows, provider reports, audit records, compliance events, and admin review to protect the platform.",
            "Accounts, listings, reservations, reports, appeals, notifications, and compliance requests may be reviewed, restricted, archived, anonymized, or retained according to the applicable workflow.",
            "Admins must use admin workflows only for authorized operational, governance, compliance, and support purposes.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Food Safety And Liability">
        <p>
          Providers remain responsible for food safety and listing accuracy.
          NGOs, users, and volunteers must use reasonable care while handling or
          distributing food. FoodForAll provides coordination software and
          operational workflows, but cannot guarantee every provider, pickup,
          delivery, or food item outside the platform controls.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For support or terms questions, contact{" "}
          <a className="font-medium text-emerald-700" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
