"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import NotificationBell from "@/components/notifications/NotificationBell";
import { getRoleDashboard } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@shared/contracts/api-contracts";

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
    { href: "/ngo/volunteers", label: "Volunteers" },
  ],
  volunteer: [
    { href: "/volunteer/ngos", label: "NGOs" },
    { href: "/volunteer/requests", label: "Requests" },
    { href: "/volunteer/tasks", label: "Tasks" },
  ],
  admin: [{ href: "/admin", label: "Admin" }],
};

function isActive(pathname: string, href: string) {
  if (href === "/ngo" || href === "/volunteer/dashboard") {
    return pathname === href;
  }

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
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = () => {
      if (mediaQuery.matches) setDrawerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    mediaQuery.addEventListener("change", handleChange);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      mediaQuery.removeEventListener("change", handleChange);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

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
  const drawerTabIndex = drawerOpen ? undefined : -1;

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  const mobileDrawer = (
    <>
      <div
        className={`fixed inset-0 z-[100] h-dvh w-dvw bg-zinc-950/55 transition-opacity duration-200 lg:hidden ${
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
        onClick={() => setDrawerOpen(false)}
      />

      <aside
        id="mobile-navigation-drawer"
        aria-label="Mobile navigation"
        aria-hidden={!drawerOpen}
        className={`fixed left-0 top-0 z-[110] flex h-dvh w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-zinc-200 bg-white shadow-2xl transition-transform duration-300 ease-out lg:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <Link
            href={dashboardHref}
            onClick={() => setDrawerOpen(false)}
            tabIndex={drawerTabIndex}
            className="min-w-0"
          >
            <p className="truncate text-base font-semibold text-zinc-950">
              Food Rescue
            </p>
            <p className="mt-0.5 text-xs capitalize text-zinc-500">
              {String(currentRole ?? "account")}
            </p>
          </Link>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            tabIndex={drawerTabIndex}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {links.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                tabIndex={drawerTabIndex}
                className={`block rounded-md px-3 py-3 text-sm font-medium transition ${
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

        <div className="border-t border-zinc-100 p-3">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            tabIndex={drawerTabIndex}
            className="flex w-full items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-3 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </aside>
    </>
  );

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-controls="mobile-navigation-drawer"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 lg:hidden"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>

            <Link
              href={dashboardHref}
              className="truncate text-base font-semibold text-zinc-950"
            >
              Food Rescue
            </Link>
          </div>

          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
            {links.map((item) => {
              const active = isActive(pathname, item.href);

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

          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="hidden rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 lg:inline-flex"
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        </div>
      </header>

      {typeof document !== "undefined"
        ? createPortal(mobileDrawer, document.body)
        : null}
    </>
  );
}
