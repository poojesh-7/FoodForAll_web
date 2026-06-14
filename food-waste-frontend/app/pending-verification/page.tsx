"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect, getRoleRegistrationRoute } from "@/lib/onboarding";
import { authService } from "@/services/auth";
import { useAuthStore } from "@/store/authStore";

export default function PendingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [rejectedRole, setRejectedRole] = useState<"provider" | "ngo" | null>(
    null
  );

  useEffect(() => {
    let active = true;

    async function refreshVerificationStatus() {
      const refreshedUser = await authService.fetchMe().catch(() => null);

      if (!active) return;
      if (!refreshedUser) return;

      setUser(refreshedUser);

      if (
        (refreshedUser?.role === "provider" || refreshedUser?.role === "ngo") &&
        refreshedUser.verification_status === "rejected"
      ) {
        setRejectedRole(refreshedUser.role);
        setRejectionReason(refreshedUser.rejection_reason ?? null);
        return;
      }

      const redirect = getPostAuthRedirect(refreshedUser);
      if (redirect !== "/pending-verification") {
        router.replace(redirect);
      }
    }

    void refreshVerificationStatus();

    return () => {
      active = false;
    };
  }, [router, setUser]);

  if (rejectedRole) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
        <section className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-red-700">
            Verification status
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
            Verification Rejected
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            {rejectionReason ||
              "Please update your details and submit your verification again."}
          </p>
          <button
            type="button"
            onClick={() => router.push(getRoleRegistrationRoute(rejectedRole))}
            className="mt-6 rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white"
          >
            Update and Resubmit
          </button>
        </section>
      </main>
    );
  }

  const roleLabel = user?.role === "ngo" ? "NGO" : "Provider";

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <section className="w-full max-w-xl rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-emerald-700">
          Verification status
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
          Verification Under Review
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Your application has been submitted successfully.
        </p>

        <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Status
          </p>
          <p className="mt-1 text-base font-semibold text-amber-950">
            Pending Verification
          </p>
        </div>

        <div className="mt-5 space-y-3 text-sm leading-6 text-zinc-600">
          <p>
            {roleLabel} applications are manually reviewed by the FoodForAll
            team before dashboard access is enabled.
          </p>
          <p>
            Approval may take some time. You can safely return later and sign in
            with Google to continue from your latest verification status.
          </p>
        </div>
      </section>
    </main>
  );
}
