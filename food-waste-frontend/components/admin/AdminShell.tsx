"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin", label: "Operations" },
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
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Admin Control Center
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-950">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-zinc-600">{description}</p>
            )}
          </div>

          <nav className="flex gap-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
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
                  className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-zinc-950 text-white"
                      : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
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
