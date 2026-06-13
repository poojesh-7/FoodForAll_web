import type { Metadata } from "next";
import {
  businessName,
  domainSupportEmail,
  LegalPageShell,
  LegalSection,
  plannedDomain,
  SimpleList,
  supportEmail,
} from "@/components/public/PublicSite";

export const metadata: Metadata = {
  title: "Contact Us | FoodForAll",
  description:
    "Contact FoodForAll support for account, onboarding, payment, refund, NGO, provider, or volunteer questions.",
};

export default function ContactPage() {
  return (
    <LegalPageShell
      title="Contact Us"
      description="FoodForAll support can help with account access, onboarding, reservations, payments, refunds, provider verification, NGO workflows, volunteer workflows, and compliance requests."
    >
      <LegalSection title="Business Details">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Business Name
            </dt>
            <dd className="mt-1 font-medium text-zinc-950">{businessName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Planned Domain (coming soon)
            </dt>
            <dd className="mt-1 font-medium text-zinc-950">{plannedDomain}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Support Email
            </dt>
            <dd className="mt-1">
              <a
                className="font-medium text-emerald-700"
                href={`mailto:${supportEmail}`}
              >
                {supportEmail}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Future Domain Support Mailbox
            </dt>
            <dd className="mt-1">
              <a
                className="font-medium text-emerald-700"
                href={`mailto:${domainSupportEmail}`}
              >
                {domainSupportEmail}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Response Time
            </dt>
            <dd className="mt-1 font-medium text-zinc-950">Within 48 hours</dd>
          </div>
        </dl>
      </LegalSection>

      <LegalSection title="What To Include">
        <SimpleList
          items={[
            "For login issues: the Google account email, account phone number if available, and a short description of the issue.",
            "For Google account issues: the Google email shown on the account and whether the issue is sign-in, duplicate email, or account linking.",
            "For account recovery: the Google email, phone number, role, and any recent reservation or onboarding reference.",
            "For reservations or refunds: reservation ID, order reference, payment status, and screenshots if available.",
            "For NGO onboarding: organization name, registration number, service area, and verification question.",
            "For provider onboarding: restaurant/provider name, FSSAI details, and verification question.",
            "For volunteer support: NGO name, task or request reference, and availability issue.",
            "For privacy or compliance requests: the account phone number, request type, and any relevant context.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Support Scope">
        <p>
          FoodForAll support reviews platform issues, onboarding questions,
          payment and refund status, safety reports, moderation concerns, and
          privacy or compliance requests. Emergency food safety or public health
          incidents should also be reported to the relevant local authority.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
