"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/axios";

export default function SelectRolePage() {
  const router = useRouter();

  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);

  // 🔐 Ensure user is authenticated via cookies
  useEffect(() => {
    const phone = localStorage.getItem("phone");

    if (!phone) {
      router.replace("/login");
    }
  }, [router]);

  const getRouteByRole = (role: string) => {
    switch (role) {
      case "user":
      case "volunteer":
        return "/complete-profile";
      case "ngo":
        return "/ngo/register";
      case "provider":
        return "/restaurant/register";
      default:
        return "/login";
    }
  };

  const handleSubmit = async () => {
    if (!role) {
      alert("Please select a role");
      return;
    }

    try {
      setLoading(true);

      // 🔥 Cookie-based auth → no phone needed
      await api.post("/auth/set-role", { role });

      const nextRoute = getRouteByRole(role);
      router.push(nextRoute);

    } catch (err: any) {
      console.error(err);
      alert(err?.response?.data?.error || "Failed to set role");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border rounded-xl p-6 space-y-4">

        <h1 className="text-2xl font-semibold text-center">
          Select Your Role
        </h1>

        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full border p-3 rounded-lg"
        >
          <option value="">Select role</option>
          <option value="user">User</option>
          <option value="volunteer">Volunteer</option>
          <option value="ngo">NGO</option>
          <option value="provider">Provider</option>
        </select>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-black text-white p-3 rounded-lg disabled:opacity-50"
        >
          {loading ? "Processing..." : "Continue"}
        </button>

      </div>
    </div>
  );
}