"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AUTH_SESSION_EXPIRED_EVENT } from "@/lib/axios";
import {
  getPostAuthRedirect,
  getRouteAccessRedirect,
  pendingVerificationRoute,
} from "@/lib/onboarding";
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

function getSessionExpiredLoginPath(pathname: string) {
  const params = new URLSearchParams({
    next: pathname,
    session: "expired",
  });
  return `/login?${params.toString()}`;
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
  const authError = useAuthStore((state) => state.authError);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const clearMessages = useAuthStore((state) => state.clearMessages);
  const expireSession = useAuthStore((state) => state.expireSession);

  const authResolved = initialized && !isInitializing;
  const isProtectedRoute = matchesRoute(pathname, protectedRoutes);
  const isGuestOnlyRoute = matchesRoute(pathname, guestOnlyRoutes);
  const isPendingVerificationRoute = matchesRoute(pathname, [
    pendingVerificationRoute,
  ]);
  const routeAccessRedirect =
    authResolved && user ? getRouteAccessRedirect(user, pathname) : null;
  const guestRedirect =
    authResolved && isAuthenticated ? getPostAuthRedirect(user) : null;
  const canRenderPendingVerification =
    isPendingVerificationRoute && Boolean(user) && !loading;

  useEffect(() => {
    clearMessages();
  }, [clearMessages, pathname]);

  useEffect(() => {
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expireSession);
    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expireSession);
    };
  }, [expireSession]);

  useEffect(() => {
    if (!isProtectedRoute && !isGuestOnlyRoute) return;
    if (initialized || isInitializing) return;

    void bootstrapAuth();
  }, [
    bootstrapAuth,
    initialized,
    isGuestOnlyRoute,
    isInitializing,
    isProtectedRoute,
  ]);

  useEffect(() => {
    if (!isProtectedRoute || !authResolved) return;

    if (!user) {
      if (authError) return;
      router.replace(getSessionExpiredLoginPath(pathname));
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
    authError,
  ]);

  useEffect(() => {
    if (isGuestOnlyRoute && guestRedirect) {
      router.replace(guestRedirect);
    }
  }, [guestRedirect, isGuestOnlyRoute, router]);

  if (isGuestOnlyRoute && (isInitializing || guestRedirect)) {
    return <FullscreenLoading />;
  }

  if (isProtectedRoute && authResolved && !user && authError) {
    return (
      <SessionRecoveryError
        message={authError}
        onRetry={() => {
          void bootstrapAuth();
        }}
      />
    );
  }

  if (isProtectedRoute && authResolved && !user) {
    return (
      <FullscreenLoading message="Your session has expired. Redirecting to login..." />
    );
  }

  if (isProtectedRoute && routeAccessRedirect) {
    return <FullscreenLoading />;
  }

  if (
    isProtectedRoute &&
    (!authResolved || loading) &&
    !canRenderPendingVerification
  ) {
    return <FullscreenLoading />;
  }

  return <>{children}</>;
}

function FullscreenLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
      {message}
    </div>
  );
}

function SessionRecoveryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-zinc-700">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
