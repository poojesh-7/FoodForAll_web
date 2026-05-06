"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

const protectedRoutes = [
  "/dashboard",
  "/select-role",
  "/complete-profile",
  "/ngo/register",
  "/restaurant/register",
  "/pending-verification",
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
  const initialized = useAuthStore((state) => state.initialized);
  const loading = useAuthStore((state) => state.loading);
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const isProtectedRoute = matchesRoute(pathname, protectedRoutes);
  const isGuestOnlyRoute = matchesRoute(pathname, guestOnlyRoutes);

  useEffect(() => {
    clearMessages();
  }, [clearMessages, pathname]);

  useEffect(() => {
    if (!isProtectedRoute) return;

    let active = true;

    fetchMe().then((authUser) => {
      if (!active || authUser) return;

      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });

    return () => {
      active = false;
    };
  }, [fetchMe, isProtectedRoute, pathname, router]);

  useEffect(() => {
    if (isGuestOnlyRoute && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isGuestOnlyRoute, router]);

  if (isProtectedRoute && (!initialized || loading) && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
        Loading...
      </div>
    );
  }

  return <>{children}</>;
}
