"use client";

import { useEffect } from "react";
import { socket } from "@/lib/socket";
import LogoutButton from "@/components/LogoutButton";

export default function DashboardPage() {
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