import Link from "next/link";

const navItems = [
  { href: "/volunteer/dashboard", label: "Dashboard" },
  { href: "/volunteer/ngos", label: "NGOs" },
  { href: "/volunteer/requests", label: "Requests" },
  { href: "/volunteer/tasks", label: "Tasks" },
];

type VolunteerShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export default function VolunteerShell({
  title,
  description,
  children,
}: VolunteerShellProps) {
  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-zinc-600">{description}</p>
            )}
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
