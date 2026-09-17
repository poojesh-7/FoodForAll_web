"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin", label: "Operations" },
  { href: "/admin/monitoring", label: "Monitoring" },
  { href: "/admin/incidents", label: "Incidents" },
  { href: "/admin/business-metrics", label: "Business Metrics" },
  { href: "/admin/financials", label: "Financials" },
  { href: "/admin/settlements", label: "Settlements" },
  { href: "/admin/compliance", label: "Compliance" },
  { href: "/admin/governance-dashboard", label: "Governance" },
  { href: "/admin/audit-center", label: "Audit Center" },
  { href: "/admin/ngos", label: "NGO Moderation" },
  { href: "/admin/restaurants", label: "Restaurant Moderation" },
  { href: "/admin/provider-reports", label: "Provider Reports" },
  { href: "/admin/moderation-appeals", label: "Appeals" },
  { href: "/admin/governance-intelligence", label: "Intelligence" },
  { href: "/admin/trust", label: "Trust" },
  { href: "/admin/queues", label: "Queues" },
];

type AdminShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export default function AdminShell({
  title,
  description,
  children,
}: AdminShellProps) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-hover)]">
              Admin Control Center
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">{title}</h1>
            {description && (
              <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">{description}</p>
            )}
          </div>

          <nav className="flex gap-1 overflow-x-auto border-y border-[var(--border)] bg-[var(--surface)] py-2" aria-label="Admin navigation">
            {navItems.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === item.href
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`) ||
                    (item.href === "/admin/provider-reports" &&
                      pathname.startsWith("/admin/moderation-cases/")) ||
                    (item.href === "/admin/moderation-appeals" &&
                      pathname.startsWith("/admin/moderation-appeals"));

              return (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--brand-soft)] text-[var(--brand-hover)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {children}
      </div>
    </main>
  );
}
