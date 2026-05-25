"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@shared/contracts/api-contracts";

const roles: Array<{ value: UserRole; label: string; description: string }> = [
  {
    value: "user",
    label: "Food Seeker",
    description: "Reserve available food for yourself or your family.",
  },
  {
    value: "volunteer",
    label: "Volunteer",
    description: "Help NGOs collect and deliver food.",
  },
  {
    value: "ngo",
    label: "NGO",
    description: "Coordinate food collection and distribution.",
  },
  {
    value: "provider",
    label: "Food Provider",
    description: "Share surplus food from your restaurant or kitchen.",
  },
];

export default function SelectRolePage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const authError = useAuthStore((state) => state.authError);
  const setRole = useAuthStore((state) => state.setRole);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const [selectedRole, setSelectedRole] = useState<UserRole | "">("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!user?.role) return;

    router.replace(getPostAuthRedirect(user));
  }, [router, user]);

  const handleSubmit = async () => {
    if (!selectedRole) {
      setFormError("Please select a role.");
      return;
    }

    setFormError("");
    clearMessages();

    const updatedUser = await setRole(selectedRole);

    if (updatedUser) {
      router.push(getPostAuthRedirect(updatedUser));
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-2xl space-y-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">Select Your Role</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Choose the account type that matches how you will use the platform.
          </p>
        </div>

        {(formError || authError) && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError || authError}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <label
              key={role.value}
              className={`cursor-pointer rounded-lg border p-4 transition ${
                selectedRole === role.value
                  ? "border-zinc-950 bg-zinc-50"
                  : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={role.value}
                checked={selectedRole === role.value}
                onChange={() => {
                  setSelectedRole(role.value);
                  setFormError("");
                  clearMessages();
                }}
                className="sr-only"
              />
              <span className="block text-sm font-semibold text-zinc-950">
                {role.label}
              </span>
              <span className="mt-1 block text-sm text-zinc-600">
                {role.description}
              </span>
            </label>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !selectedRole}
          className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </main>
  );
}
