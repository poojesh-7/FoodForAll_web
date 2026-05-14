"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getPostAuthRedirect, getRouteAccessRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

const protectedRoutes = [
  "/dashboard",
  "/select-role",
  "/complete-profile",
  "/ngo/register",
  "/restaurant/register",
  "/pending-verification",
  "/profile",
  "/notifications",
  "/admin",
  "/provider",
  "/ngo",
  "/volunteer",
  "/reservations",
  "/payment-success",
  "/payment-failed",
];

const guestOnlyRoutes = ["/login"];

function matchesRoute(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
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
  const isInitializing = useAuthStore((state) => state.isInitializing);
  const initialized = useAuthStore((state) => state.initialized);
  const loading = useAuthStore((state) => state.loading);
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const authResolved = initialized && !isInitializing;
  const isProtectedRoute = matchesRoute(pathname, protectedRoutes);
  const isGuestOnlyRoute = matchesRoute(pathname, guestOnlyRoutes);
  const routeAccessRedirect =
    authResolved && user ? getRouteAccessRedirect(user, pathname) : null;
  const guestRedirect =
    authResolved && isAuthenticated ? getPostAuthRedirect(user) : null;

  useEffect(() => {
    clearMessages();
  }, [clearMessages, pathname]);

  useEffect(() => {
    if (initialized || isInitializing) return;

    void fetchMe();
  }, [fetchMe, initialized, isInitializing]);

  useEffect(() => {
    if (!isProtectedRoute || !authResolved) return;

    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (routeAccessRedirect) {
      router.replace(routeAccessRedirect);
    }
  }, [
    authResolved,
    isProtectedRoute,
    pathname,
    routeAccessRedirect,
    router,
    user,
  ]);

  useEffect(() => {
    if (isGuestOnlyRoute && guestRedirect) {
      router.replace(guestRedirect);
    }
  }, [guestRedirect, isGuestOnlyRoute, router]);

  if (isGuestOnlyRoute && (!authResolved || guestRedirect)) {
    return <FullscreenLoading />;
  }

  if (
    isProtectedRoute &&
    (!authResolved || loading || !user || routeAccessRedirect)
  ) {
    return <FullscreenLoading />;
  }

  return <>{children}</>;
}

function FullscreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
      Loading...
    </div>
  );
}
