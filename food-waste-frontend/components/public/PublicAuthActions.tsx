"use client";

import Link from "next/link";
import { useState } from "react";
import { LayoutDashboard, LogIn, LogOut } from "lucide-react";
import { getPostAuthRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

type PublicAuthActionsVariant = "header" | "mobileMenu" | "lightCta" | "darkCta";

type PublicAuthActionsProps = {
  variant?: PublicAuthActionsVariant;
  showLogout?: boolean;
};

const variantClasses: Record<
  PublicAuthActionsVariant,
  {
    wrapper: string;
    primary: string;
    secondary: string;
    logout: string;
  }
> = {
  header: {
    wrapper: "flex items-center gap-2",
    primary:
      "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
    secondary:
      "inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
    logout:
      "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
  },
  mobileMenu: {
    wrapper: "grid gap-2",
    primary:
      "inline-flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
    secondary:
      "inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
    logout:
      "inline-flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2",
  },
  lightCta: {
    wrapper: "flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap",
    primary:
      "inline-flex w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 sm:w-auto",
    secondary:
      "inline-flex w-full shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 sm:w-auto",
    logout:
      "inline-flex w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 sm:w-auto",
  },
  darkCta: {
    wrapper: "flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap",
    primary:
      "inline-flex w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:w-auto",
    secondary:
      "inline-flex w-full shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:w-auto",
    logout:
      "inline-flex w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:w-auto",
  },
};

export default function PublicAuthActions({
  variant = "header",
  showLogout = variant === "header",
}: PublicAuthActionsProps) {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const initialized = useAuthStore((state) => state.initialized);
  const isInitializing = useAuthStore((state) => state.isInitializing);
  const logout = useAuthStore((state) => state.logout);
  const [loggingOut, setLoggingOut] = useState(false);
  const styles = variantClasses[variant];

  if (!initialized || isInitializing) {
    return null;
  }

  if (isAuthenticated && user) {
    const dashboardHref = getPostAuthRedirect(user);

    return (
      <span className={styles.wrapper}>
        <Link href={dashboardHref} className={styles.primary}>
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
        {showLogout && (
          <button
            type="button"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              await logout();
            }}
            className={`${styles.logout} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        )}
      </span>
    );
  }

  return (
    <span className={styles.wrapper}>
      <Link href="/login" className={styles.primary}>
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Login
      </Link>
      {variant !== "header" && (
        <Link href="/login" className={styles.secondary}>
          Get Started
        </Link>
      )}
    </span>
  );
}
