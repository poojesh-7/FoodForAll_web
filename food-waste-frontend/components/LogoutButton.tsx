"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/authStore";

export default function LogoutButton() {
  const logout = useAuthStore((state) => state.logout);
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    await logout();
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="bg-red-500 text-white px-4 py-2 rounded-lg disabled:opacity-50"
    >
      {loading ? "Logging out..." : "Logout"}
    </button>
  );
}