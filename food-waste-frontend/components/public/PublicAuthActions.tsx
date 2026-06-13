"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPostAuthRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

type PublicAuthActionsVariant = "header" | "lightCta" | "darkCta";

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
    wrapper: "flex flex-wrap items-center gap-x-4 gap-y-2",
    primary: "text-zinc-950 hover:text-emerald-700",
    secondary: "text-zinc-950 hover:text-emerald-700",
    logout:
      "appearance-none border-0 bg-transparent p-0 text-sm font-medium text-zinc-700 hover:text-emerald-700",
  },
  lightCta: {
    wrapper: "flex flex-wrap gap-3",
    primary:
      "rounded-md bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800",
    secondary:
      "rounded-md border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100",
    logout:
      "rounded-md border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100",
  },
  darkCta: {
    wrapper: "flex flex-wrap gap-3",
    primary:
      "rounded-md bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100",
    secondary:
      "rounded-md border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10",
    logout:
      "rounded-md border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10",
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
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const logout = useAuthStore((state) => state.logout);
  const [loggingOut, setLoggingOut] = useState(false);
  const styles = variantClasses[variant];

  useEffect(() => {
    if (initialized || isInitializing) return;

    void bootstrapAuth();
  }, [bootstrapAuth, initialized, isInitializing]);

  if (!initialized || isInitializing) {
    return null;
  }

  if (isAuthenticated && user) {
    const dashboardHref = getPostAuthRedirect(user);

    return (
      <span className={styles.wrapper}>
        <Link href={dashboardHref} className={styles.primary}>
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
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        )}
      </span>
    );
  }

  return (
    <span className={styles.wrapper}>
      <Link href="/login" className={styles.primary}>
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
