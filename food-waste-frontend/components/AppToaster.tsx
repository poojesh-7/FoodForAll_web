"use client";

import { Toaster } from "react-hot-toast";

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3500,
        style: {
          border: "1px solid #e4e4e7",
          borderRadius: "8px",
          color: "#18181b",
          fontSize: "14px",
        },
      }}
    />
  );
}
