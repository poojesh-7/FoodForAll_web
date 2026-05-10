"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRoleDashboard, getRoleRegistrationRoute } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

const VERIFICATION_POLL_INTERVAL_MS = 20_000;

export default function PendingPage() {
  const router = useRouter();
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const [checking, setChecking] = useState(true);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [rejectedRole, setRejectedRole] = useState<"provider" | "ngo" | null>(
    null
  );

  useEffect(() => {
    let active = true;

    const checkVerification = async () => {
      const user = await fetchMe();

      if (!active) return;

      if (
        (user?.role === "provider" || user?.role === "ngo") &&
        (user.is_verified || user.verification_status === "approved")
      ) {
        router.replace(getRoleDashboard(user.role));
        return;
      }

      if (
        (user?.role === "provider" || user?.role === "ngo") &&
        user.verification_status === "rejected"
      ) {
        setRejectedRole(user.role);
        setRejectionReason(user.rejection_reason ?? null);
        setChecking(false);
        if (interval) window.clearInterval(interval);
        return;
      }

      if (
        (user?.role === "provider" || user?.role === "ngo") &&
        user.verification_status === "unregistered"
      ) {
        router.replace(getRoleRegistrationRoute(user.role));
        return;
      }

      setChecking(false);
    };

    checkVerification();
    const interval = window.setInterval(
      checkVerification,
      VERIFICATION_POLL_INTERVAL_MS
    );

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [fetchMe, router]);

  if (rejectedRole) {
    return (
      <div className="h-screen flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-xl font-semibold">Verification Rejected</h1>
        <p className="mt-2 max-w-md text-gray-500">
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
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col items-center justify-center">
      <h1 className="text-xl font-semibold">
        Under Verification
      </h1>
      <p className="text-gray-500">
        Please wait for admin approval
      </p>
      <p className="mt-4 flex items-center gap-2 text-sm text-gray-500">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
        {checking ? "Checking verification status..." : "Checking verification status periodically..."}
      </p>
    </div>
  );
}
