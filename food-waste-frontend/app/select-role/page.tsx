"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authService } from "@/services/auth";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@backend/contracts/api-contracts";

export default function SelectRolePage() {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);

  const [role, setRole] = useState<UserRole | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const getRouteByRole = (selectedRole: UserRole) => {
    switch (selectedRole) {
      case "user":
      case "volunteer":
        return "/complete-profile";
      case "ngo":
        return "/ngo/register";
      case "provider":
        return "/restaurant/register";
      default:
        return "/dashboard";
    }
  };

  const handleSubmit = async () => {
    if (!role || loading) {
      setError("Please select a role.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const result = await authService.setRole({ role });
      setUser(result.user);
      router.push(getRouteByRole(role));
    } catch (err) {
      setError(authService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-950">Select Your Role</h1>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <select
          value={role}
          onChange={(event) => {
            setRole(event.target.value as UserRole | "");
            setError("");
          }}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
        >
          <option value="">Select role</option>
          <option value="user">User</option>
          <option value="volunteer">Volunteer</option>
          <option value="ngo">NGO</option>
          <option value="provider">Provider</option>
        </select>

        <button
          onClick={handleSubmit}
          disabled={loading || !role}
          className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Processing..." : "Continue"}
        </button>
      </div>
    </main>
  );
}
