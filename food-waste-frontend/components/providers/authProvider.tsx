"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getRoleDashboard, getRouteAccessRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

const protectedRoutes = [
  "/dashboard",
  "/select-role",
  "/complete-profile",
  "/ngo/register",
  "/restaurant/register",
  "/pending-verification",
  "/profile",
  "/admin",
  "/provider",
  "/ngo",
  "/volunteer",
  "/reservations",
  "/payment-success",
  "/payment-failed",
];

const guestOnlyRoutes = ["/login"];
const paymentReturnRoutes = ["/payment-success", "/payment-failed"];
const PAYMENT_RETURN_AUTH_DELAY_MS = 300;

function matchesRoute(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isReservationDetailRoute(pathname: string) {
  return /^\/reservations\/[^/]+$/.test(pathname);
}

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const initialized = useAuthStore((state) => state.initialized);
  const loading = useAuthStore((state) => state.loading);
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const isProtectedRoute = matchesRoute(pathname, protectedRoutes);
  const isGuestOnlyRoute = matchesRoute(pathname, guestOnlyRoutes);
  const isPaymentReturnRoute = matchesRoute(pathname, paymentReturnRoutes);
  const isRecoveryFriendlyRoute =
    isPaymentReturnRoute || isReservationDetailRoute(pathname);

  useEffect(() => {
    clearMessages();
  }, [clearMessages, pathname]);

  useEffect(() => {
    if (!isProtectedRoute) return;

    let active = true;
    let timer: number | undefined;

    const hydrate = () => {
      fetchMe().then((authUser) => {
        if (!active) return;

        if (!authUser) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }

        const redirectPath = getRouteAccessRedirect(authUser, pathname);

        if (redirectPath) {
          router.replace(redirectPath);
        }
      });
    };

    if (isPaymentReturnRoute) {
      timer = window.setTimeout(hydrate, PAYMENT_RETURN_AUTH_DELAY_MS);
    } else {
      hydrate();
    }

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [fetchMe, isPaymentReturnRoute, isProtectedRoute, pathname, router]);

  useEffect(() => {
    if (isGuestOnlyRoute && isAuthenticated) {
      router.replace(getRoleDashboard(user?.role));
    }
  }, [isAuthenticated, isGuestOnlyRoute, router, user?.role]);

  if (
    isProtectedRoute &&
    !isRecoveryFriendlyRoute &&
    (!initialized || loading) &&
    !user
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
        Loading...
      </div>
    );
  }

  return <>{children}</>;
}
