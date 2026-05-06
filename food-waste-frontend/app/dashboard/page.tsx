"use client";

import { useEffect } from "react";
import { socket } from "@/lib/socket";
import LogoutButton from "@/components/LogoutButton";
import { getRoleDashboard } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    const dashboard = getRoleDashboard(user?.role);
    if (dashboard !== "/dashboard") {
      router.replace(dashboard);
    }
  }, [router, user?.role]);

  useEffect(() => {
    socket.connect();

    socket.on("food:new", (data) => {
      console.log("New food:", data);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">
        Dashboard
      </h1>
      <LogoutButton />
    </div>
  );
}
