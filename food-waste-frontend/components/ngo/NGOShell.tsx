import Link from "next/link";

const navItems = [
  { href: "/ngo", label: "Dashboard" },
  { href: "/ngo/nearby-listings", label: "Nearby Listings" },
  { href: "/ngo/incoming-requests", label: "Incoming Requests" },
  { href: "/ngo/reservations", label: "Reservations" },
  { href: "/ngo/volunteers", label: "Volunteers" },
];

type NGOShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export default function NGOShell({
  title,
  description,
  children,
}: NGOShellProps) {
  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-950">{title}</h1>
              {description && (
                <p className="mt-1 text-sm text-zinc-600">{description}</p>
              )}
            </div>
          </div>

          <nav className="flex gap-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        {children}
      </div>
    </main>
  );
}
