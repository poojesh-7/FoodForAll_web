"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@shared/contracts/api-contracts";


type CompleteProfileForm = {
  name: string;
  email: string;
  address: string;
  useCurrentLocation: boolean;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

function getUserPhone(user: ReturnType<typeof useAuthStore.getState>["user"]) {
  return user && "phone" in user ? user.phone : null;
}

function isProfileRole(role: UserRole | null | undefined) {
  return role === "user" || role === "volunteer";
}

export default function CompleteProfilePage() {
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const authError = useAuthStore((state) => state.authError);
  const authSuccess = useAuthStore((state) => state.authSuccess);
  const completeProfile = useAuthStore((state) => state.completeProfile);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const [form, setForm] = useState<CompleteProfileForm>({
    name: user && "name" in user && user.name ? user.name : "",
    email: user && "email" in user && user.email ? user.email : "",
    address: "",
    useCurrentLocation: true,
  });
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!user?.role) {
      router.replace(getPostAuthRedirect(user));
      return;
    }

    if (!isProfileRole(user.role)) {
      router.replace(getPostAuthRedirect(user));
    }
  }, [router, user]);

  const submit = async () => {
    if (loading) return;

    const phone = getUserPhone(user);

    if (!user?.role || !isProfileRole(user.role)) {
      router.replace(getPostAuthRedirect(user));
      return;
    }

    if (!phone) {
      setFormError("Session is missing a phone number. Please login again.");
      return;
    }

    if (!form.name.trim() || !form.email.trim()) {
      setFormError("Name and email are required.");
      return;
    }

    try {
      setFormError("");
      clearMessages();

      const position = form.useCurrentLocation ? await getCurrentPosition() : null;
      const updatedUser = await completeProfile({
        phone,
        name: form.name.trim(),
        email: form.email.trim(),
        role: user.role,
        address: form.address.trim() || null,
        latitude: position?.coords.latitude ?? null,
        longitude: position?.coords.longitude ?? null,
      });

      if (updatedUser) {
        router.push(getPostAuthRedirect(updatedUser));
      }
    } catch {
      setFormError("Please allow location access or turn off location sharing.");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">Complete Profile</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Add the basic details needed for your account.
          </p>
        </div>

        {(formError || authError || authSuccess) && (
          <div className="space-y-2">
            {(formError || authError) && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError || authError}
              </p>
            )}
            {authSuccess && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {authSuccess}
              </p>
            )}
          </div>
        )}

        <input
          value={form.name}
          placeholder="Name"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />

        <input
          value={form.email}
          type="email"
          placeholder="Email"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />

        <input
          value={form.address}
          placeholder="Address"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => setForm({ ...form, address: event.target.value })}
        />

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={form.useCurrentLocation}
            onChange={(event) =>
              setForm({ ...form, useCurrentLocation: event.target.checked })
            }
          />
          Use my current location
        </label>

        <button
          onClick={submit}
          disabled={loading}
          className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </main>
  );
}
