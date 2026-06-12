"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@shared/contracts/api-contracts";

const roles: Array<{ value: UserRole; label: string; description: string }> = [
  {
    value: "user",
    label: "User",
    description: "Reserve available food.",
  },
  {
    value: "ngo",
    label: "NGO",
    description: "Rescue and distribute food to communities.",
  },
  {
    value: "provider",
    label: "Provider",
    description: "Share surplus food and reduce waste.",
  },
  {
    value: "volunteer",
    label: "Volunteer",
    description: "Assist with pickups and deliveries.",
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
      <div className="w-full max-w-4xl space-y-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-emerald-700">
            FoodForAll onboarding
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
            Welcome to FoodForAll
          </h1>
          <p className="mt-2 text-base text-zinc-600">
            How would you like to use the platform?
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
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-zinc-200 bg-white hover:border-zinc-400"
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
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-base font-semibold text-zinc-950">
                    {role.label}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-zinc-600">
                    {role.description}
                  </span>
                </span>
                <span
                  className={`mt-1 h-3 w-3 rounded-full border ${
                    selectedRole === role.value
                      ? "border-emerald-600 bg-emerald-600"
                      : "border-zinc-300 bg-white"
                  }`}
                />
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
