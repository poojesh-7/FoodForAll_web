"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import NotificationBell from "@/components/notifications/NotificationBell";
import { getRoleDashboard } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@backend/contracts/api-contracts";

const roleLinks: Partial<Record<UserRole, { href: string; label: string }[]>> = {
  user: [
    { href: "/food", label: "Food" },
    { href: "/reservations", label: "Reservations" },
  ],
  provider: [
    { href: "/provider/listings", label: "Listings" },
    { href: "/provider/reservations", label: "Reservations" },
  ],
  ngo: [
    { href: "/ngo/nearby-listings", label: "Listings" },
    { href: "/ngo/incoming-requests", label: "Requests" },
    { href: "/ngo/reservations", label: "Reservations" },
  ],
  volunteer: [
    { href: "/volunteer/tasks", label: "Tasks" },
    { href: "/volunteer/requests", label: "Requests" },
  ],
  admin: [{ href: "/admin", label: "Admin" }],
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNavigation() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const initialized = useAuthStore((state) => state.initialized);
  const isInitializing = useAuthStore((state) => state.isInitializing);
  const isOnboarded = useAuthStore((state) => state.isOnboarded);
  const logout = useAuthStore((state) => state.logout);
  const [loggingOut, setLoggingOut] = useState(false);

  if (
    !initialized ||
    isInitializing ||
    !isAuthenticated ||
    !isOnboarded ||
    !user
  ) {
    return null;
  }

  const dashboardHref = getRoleDashboard(user.role);
  const currentRole = user.role;
  const links = [
    { href: dashboardHref, label: "Dashboard" },
    ...(currentRole ? roleLinks[currentRole] ?? [] : []),
    { href: "/notifications", label: "Notifications" },
    { href: "/profile", label: "Profile" },
  ];

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={dashboardHref}
            className="text-base font-semibold text-zinc-950"
          >
            Food Rescue
          </Link>
          <div className="flex items-center gap-2 sm:hidden">
            <NotificationBell />
          </div>
        </div>

        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto sm:justify-center">
          {links.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={item.href}
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

        <div className="hidden items-center gap-2 sm:flex">
          <NotificationBell />
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>
    </header>
  );
}
