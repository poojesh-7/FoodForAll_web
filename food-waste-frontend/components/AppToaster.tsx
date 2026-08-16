"use client";

import { Toaster } from "react-hot-toast";

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      gutter={10}
      containerClassName="operational-toaster"
      containerStyle={{
        top: "calc(env(safe-area-inset-top, 0px) + 4.75rem)",
        left: "auto",
        right: "max(1rem, env(safe-area-inset-right, 0px))",
        zIndex: 70,
      }}
      toastOptions={{
        duration: 5000,
        className: "app-toast-shell",
        ariaProps: {
          role: "status",
          "aria-live": "polite",
        },
        style: {
          alignItems: "stretch",
          background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 72%)",
          border: "1px solid #bbf7d0",
          borderRadius: "12px",
          boxShadow:
            "0 16px 38px rgba(20, 83, 45, 0.14), 0 3px 12px rgba(24, 24, 27, 0.08)",
          color: "#18181b",
          display: "block",
          fontSize: "14px",
          justifyContent: "flex-start",
          lineHeight: "1.45",
          width: "min(23.5rem, calc(100vw - 2rem))",
          minWidth: "min(20rem, calc(100vw - 2rem))",
          maxWidth: "min(23.5rem, calc(100vw - 2rem))",
          padding: "0",
          textAlign: "left",
          overflowWrap: "anywhere",
        },
      }}
    />
  );
}
