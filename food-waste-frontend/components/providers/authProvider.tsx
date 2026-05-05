"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

const publicRoutes = [
  "/login",
  "/select-role",  
  "/complete-profile",
  "/onboarding",
];

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
    const isPublic = publicRoutes.includes(pathname);

    if (isPublic) return;

    fetchMe();
  }, [pathname, fetchMe]);

  return <>{children}</>;
}