"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect, getRoleRegistrationRoute } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

type AuthStoreUser = ReturnType<typeof useAuthStore.getState>["user"];
type RejectedRole = "provider" | "ngo";

const refreshedPendingUsers = new Set<string>();

function getVerificationRole(role: unknown): RejectedRole | null {
  return role === "provider" || role === "ngo" ? role : null;
}

function getVerificationStatus(user: AuthStoreUser) {
  if (!user) return null;
  if ("verification_status" in user && user.verification_status) {
    return user.verification_status;
  }
  if ("is_verified" in user && user.is_verified) return "approved";
  return null;
}

function getRejectionReason(user: AuthStoreUser) {
  if (!user || !("rejection_reason" in user)) return null;
  return user.rejection_reason ?? null;
}

export default function PendingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const verificationRole = getVerificationRole(user?.role);
  const verificationStatus = getVerificationStatus(user);
  const rejectedRole =
    verificationRole && verificationStatus === "rejected"
      ? verificationRole
      : null;
  const rejectionReason = rejectedRole ? getRejectionReason(user) : null;
  const pendingRefreshKey = user?.id ? String(user.id) : null;
  const shouldRefreshOnce =
    Boolean(verificationRole && pendingRefreshKey) &&
    (verificationStatus === "pending" ||
      verificationStatus === "unregistered" ||
      verificationStatus === null);

  useEffect(() => {
    if (!shouldRefreshOnce || !pendingRefreshKey) return;
    if (refreshedPendingUsers.has(pendingRefreshKey)) return;

    refreshedPendingUsers.add(pendingRefreshKey);
    let active = true;

    async function refreshVerificationStatus() {
      const refreshedUser = await fetchMe({ allowStaleOnFailure: false }).catch(
        () => null
      );

      if (!active) return;
      if (!refreshedUser) return;

      const redirect = getPostAuthRedirect(refreshedUser);
      if (redirect !== "/pending-verification") {
        router.replace(redirect);
      }
    }

    void refreshVerificationStatus();

    return () => {
      active = false;
    };
  }, [fetchMe, pendingRefreshKey, router, shouldRefreshOnce]);

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
            Most reviews are completed within 1-2 business days. Keep your
            Google account and contact phone available in case the review team
            needs clarification.
          </p>
          <p>
            You can safely return later and sign in with Google to continue from
            your latest verification status.
          </p>
        </div>
      </section>
    </main>
  );
}
