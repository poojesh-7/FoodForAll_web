import type { Metadata } from "next";
import {
  businessName,
  LegalPageShell,
  LegalSection,
  SimpleList,
  supportEmail,
} from "@/components/public/PublicSite";

export const metadata: Metadata = {
  title: "Privacy Policy | FoodForAll",
  description:
    "Privacy Policy for FoodForAll, including OTP login, profile, location, reservation, notification, compliance, and account anonymization practices.",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      description="This policy explains what FoodForAll collects and how the platform uses data to operate food rescue, reservations, payments, notifications, trust, and compliance workflows."
    >
      <LegalSection title="Who We Are">
        <p>
          {businessName} is a food rescue platform connecting users, NGOs,
          providers, and volunteers. For privacy questions, contact{" "}
          <a className="font-medium text-emerald-700" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Information We Collect">
        <SimpleList
          items={[
            "Phone numbers used for OTP login, authentication, and account recovery.",
            "Name, email address, role, address, and profile information provided during onboarding or profile updates.",
            "Location data when users, NGOs, providers, or volunteers allow location access or register service areas.",
            "Provider registration details, including restaurant name, FSSAI number, FSSAI certificate, service radius, and provider location.",
            "NGO registration details, including organization name, registration number, service radius, and NGO location.",
            "Food listing data such as title, description, quantity, price, pickup window, availability, and listing location.",
            "Reservation records, pickup state, cancellation state, payment state, and related operational timestamps.",
            "Volunteer activity such as NGO join requests, task availability, task start, and task completion.",
            "Notification records, unread counts, and realtime delivery state used to show account and pickup updates.",
            "Provider reports, moderation appeals, compliance requests, audit records, operational events, trust events, and governance history.",
          ]}
        />
      </LegalSection>

      <LegalSection title="How We Use Information">
        <SimpleList
          items={[
            "To verify users through OTP and maintain secure authenticated sessions.",
            "To route each account through the correct user, NGO, provider, volunteer, or admin workflow.",
            "To show nearby food, NGO, provider, volunteer, reservation, pickup, and delivery activity.",
            "To create and update food listings, reservations, payment holds, cancellations, refunds, and impact metrics.",
            "To send account, reservation, moderation, volunteer, provider, and operational notifications.",
            "To apply trust, abuse-prevention, restriction, governance, compliance, incident, audit, and financial integrity workflows.",
            "To investigate disputes, provider reports, payment issues, queue failures, and safety or policy concerns.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Payments">
        <p>
          FoodForAll uses Cashfree for checkout. Users enter payment information
          through Cashfree checkout, not through FoodForAll form fields. The
          platform stores payment references needed to operate reservations,
          such as order IDs, payment session IDs, amounts, payment status,
          refund status, and gateway reconciliation metadata.
        </p>
      </LegalSection>

      <LegalSection title="Data Sharing">
        <p>
          FoodForAll shares information only as needed to run the platform. This
          includes payment processing with Cashfree, operational notifications,
          provider/NGO/volunteer coordination, compliance review, audit review,
          and lawful requests where applicable. Role-based access controls limit
          what different account types can see.
        </p>
      </LegalSection>

      <LegalSection title="Retention, Anonymization, And Deletion">
        <SimpleList
          items={[
            "Compliance requests are reviewed and executed through an admin-controlled workflow.",
            "Account deletion and anonymization requests revoke account access and anonymize contact fields such as name, phone, email, profile image, address, location, and refresh-token state.",
            "Provider and NGO identity fields may be anonymized where the request applies to those records.",
            "Financial records, trust replay records, audit records, moderation history, incident history, and compliance events are retained where needed for integrity, safety, reconciliation, investigations, or legal obligations.",
            "Notifications and evidence records may be archived instead of physically deleted so audit and moderation history remains verifiable.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Your Choices">
        <SimpleList
          items={[
            "You can choose whether to grant browser location permission.",
            "You can update supported profile fields inside the application.",
            "You can contact FoodForAll for privacy, data access, anonymization, or account deletion requests.",
            "Some records may be preserved in anonymized or archived form where required for payments, trust, audit, governance, or compliance integrity.",
          ]}
        />
      </LegalSection>
    </LegalPageShell>
  );
}
