"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

export default function SelectRolePage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setRole = useAuthStore((state) => state.setRole);

  useEffect(() => {
    if (user?.role) return;
    void setRole("user").then((updatedUser) => {
      if (updatedUser) router.replace("/complete-profile");
    });
  }, [router, setRole, user?.role]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
      Setting up your account...
    </main>
  );
}
