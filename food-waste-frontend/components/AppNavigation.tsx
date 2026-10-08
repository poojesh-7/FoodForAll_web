"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import IdentityAvatar from "@/components/identity/IdentityAvatar";
import NotificationBell from "@/components/notifications/NotificationBell";
import { isNormalUserPaidListing } from "@/lib/food";
import { isActiveListing } from "@/lib/listingLifecycle";
import { getRoleDashboard } from "@/lib/onboarding";
import { getPaymentRemainingMs, getReservationPaymentState } from "@/lib/payment-flow";
import { isActiveReservation } from "@/lib/reservationLifecycle";
import { foodService } from "@/services/food.service";
import { reservationService } from "@/services/reservation.service";
import { useAuthStore } from "@/store/authStore";
import { useRealtimeStore } from "@/store/realtimeStore";
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

const publicRoutes = ["/", "/login", "/privacy", "/terms", "/refund-policy", "/contact"];

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
  const [pendingReservationCount, setPendingReservationCount] = useState(0);
  const [activeListingCount, setActiveListingCount] = useState<number | null>(null);
  const [activeReservationCount, setActiveReservationCount] = useState<number | null>(null);
  const reservationVersion = useRealtimeStore((state) => state.reservationVersion);
  const listingVersion = useRealtimeStore((state) => state.listingVersion);
  const currentRole = user?.role;
  const showMobileBottomNavigation =
    initialized &&
    !isInitializing &&
    isAuthenticated &&
    isOnboarded &&
    !publicRoutes.includes(pathname) &&
    (currentRole === "user" || currentRole === "provider");

  useEffect(() => {
    if (!showMobileBottomNavigation || !currentRole) return;
    let active = true;

    const refreshCounts = () => {
      if (currentRole === "user") {
        void reservationService
          .getMyReservations()
          .then((reservations) => {
            if (!active) return;
            setActiveReservationCount(
              reservations.filter(isActiveReservation).length
            );
            setPendingReservationCount(
              reservations.filter(
                (reservation) =>
                  getReservationPaymentState(reservation) === "payment_pending" &&
                  (getPaymentRemainingMs(reservation) ?? 0) > 0
              ).length
            );
          })
          .catch((error) => {
            console.error("Unable to refresh mobile reservation counts.", error);
          });

        void foodService
          .getActiveFood()
          .then((listings) => {
            if (!active) return;
            setActiveListingCount(
              listings.filter(
                (listing) =>
                  isNormalUserPaidListing(listing) &&
                  Number(listing.remaining_quantity ?? 0) > 0
              ).length
            );
          })
          .catch((error) => {
            console.error("Unable to refresh mobile food listing counts.", error);
          });
        return;
      }

      void reservationService
        .getProviderReservations()
        .then((reservations) => {
          if (active) {
            setActiveReservationCount(
              reservations.filter(isActiveReservation).length
            );
          }
        })
        .catch((error) => {
          console.error("Unable to refresh mobile reservation counts.", error);
        });

      void foodService
        .getAllFood()
        .then((listings) => {
          if (active) {
            setActiveListingCount(
              listings.filter(
                (listing) =>
                  String(listing.provider_id) === String(user?.id) &&
                  isActiveListing(listing)
              ).length
            );
          }
        })
        .catch((error) => {
          console.error("Unable to refresh mobile listing counts.", error);
        });
    };

    refreshCounts();
    const refreshTimer = window.setInterval(refreshCounts, 30_000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [
    currentRole,
    isAuthenticated,
    listingVersion,
    reservationVersion,
    showMobileBottomNavigation,
    user?.id,
  ]);

  useEffect(() => {
    document.body.classList.toggle(
      "has-mobile-bottom-navigation",
      showMobileBottomNavigation
    );

    return () => {
      document.body.classList.remove("has-mobile-bottom-navigation");
    };
  }, [showMobileBottomNavigation]);

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

  if (publicRoutes.includes(pathname)) {
    return null;
  }

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
  const currentRoleLinks = currentRole ? roleLinks[currentRole] ?? [] : [];
  const links = [
    { href: dashboardHref, label: "Dashboard" },
    ...currentRoleLinks,
    { href: "/notifications", label: "Notifications" },
    { href: "/profile", label: "Profile" },
  ];
  const mobileDrawerLinks = links.filter((item) => {
    if (currentRole === "user") {
      return item.href !== "/food" && item.href !== "/reservations";
    }
    if (currentRole === "provider") {
      return item.href !== "/provider/listings" && item.href !== "/provider/reservations";
    }
    return true;
  });
  const bottomNavigationLinks =
    currentRole === "user" || currentRole === "provider"
      ? currentRoleLinks
      : [];
  const drawerTabIndex = drawerOpen ? undefined : -1;
  const userName = "name" in user ? user.name : null;

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
        className={`fixed left-0 top-0 z-[110] flex h-dvh w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-elevated)] transition-transform duration-300 ease-out lg:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4">
          <Link
            href={dashboardHref}
            onClick={() => setDrawerOpen(false)}
            tabIndex={drawerTabIndex}
            className="min-w-0"
          >
            <p className="truncate text-base font-semibold text-[var(--text-primary)]">
              FoodForAll
            </p>
            <p className="mt-0.5 text-xs capitalize text-[var(--text-muted)]">
              {String(currentRole ?? "account")}
            </p>
          </Link>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            tabIndex={drawerTabIndex}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {mobileDrawerLinks.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                tabIndex={drawerTabIndex}
                className={`block rounded-md px-3 py-3 text-sm font-medium transition-colors ${
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

        <div className="border-t border-[var(--border)] p-3">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            tabIndex={drawerTabIndex}
            className="flex w-full items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-3 text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
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
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-controls="mobile-navigation-drawer"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-subtle)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] lg:hidden"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>

            <Link
              href={dashboardHref}
              className="truncate text-base font-semibold text-[var(--text-primary)]"
            >
              FoodForAll
            </Link>
          </div>

          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
            {links.map((item) => {
              const active = isActive(pathname, item.href);

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
            {currentRole === "user" && pendingReservationCount > 0 && (
              <Link
                href="/reservations"
                className="whitespace-nowrap rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                Pending {pendingReservationCount}
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link
              href="/profile"
              aria-label="Open profile"
              className="inline-flex rounded-full"
            >
              <IdentityAvatar
                src={user.profile_image_url ?? user.profile_image}
                name={userName}
                role={user.role}
                label="User avatar"
                size="md"
              />
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="hidden rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60 lg:inline-flex"
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        </div>
      </header>

      {showMobileBottomNavigation && (
        <nav
          aria-label="Primary mobile navigation"
          className="fixed inset-x-0 bottom-0 z-50 flex min-h-[calc(4rem+env(safe-area-inset-bottom,0px))] border-t border-[var(--border)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgb(21_32_26_/_0.1)] backdrop-blur lg:hidden"
        >
          {bottomNavigationLinks.map((item, index) => {
            const active = isActive(pathname, item.href);
            const count =
              item.label === "Reservations"
                ? activeReservationCount
                : activeListingCount;

            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-1 items-center justify-center gap-1.5 px-2 text-sm font-semibold transition-colors ${
                  index > 0 ? "border-l border-[var(--border)]" : ""
                } ${
                  active
                    ? "text-[var(--brand-hover)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <span>{item.label}</span>
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
                  ({count ?? "..."})
                </span>
              </Link>
            );
          })}
        </nav>
      )}

      {typeof document !== "undefined"
        ? createPortal(mobileDrawer, document.body)
        : null}
    </>
  );
}
