import Link from "next/link";
import type { ReactNode } from "react";
import { PublicNavigation, businessName } from "@/components/public/PublicNavigation";

export { businessName };
export const supportEmail = "foodforall.support@gmail.com";
export const domainSupportEmail = "support@foodforall.in";
export const plannedDomain = "foodforall.in";
export const legalLastUpdated = "June 13, 2026";

const publicLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refund-policy", label: "Refund Policy" },
  { href: "/contact", label: "Contact Us" },
];

export function PublicHeader() {
  return <PublicNavigation />;
}

export function PublicFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-zinc-600 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <p className="font-semibold text-zinc-950">FoodForAll</p>
          <p className="mt-1">Reducing food waste through responsible rescue operations.</p>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2 font-medium">
          {publicLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-emerald-700">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-50">
      <PublicHeader />
      {children}
      <PublicFooter />
    </main>
  );
}

export function LegalPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <PublicPageShell>
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-semibold text-emerald-700">
            Last updated {legalLastUpdated}
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-950 sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-base leading-7 text-zinc-600">{description}</p>
        </div>
        <div className="space-y-5">{children}</div>
      </section>
    </PublicPageShell>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700">
        {children}
      </div>
    </section>
  );
}

export function SimpleList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
