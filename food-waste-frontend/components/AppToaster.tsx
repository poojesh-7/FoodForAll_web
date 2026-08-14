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
        ariaProps: {
          role: "status",
          "aria-live": "polite",
        },
        style: {
          border: "1px solid #e4e4e7",
          borderRadius: "8px",
          color: "#18181b",
          fontSize: "14px",
          minWidth: "min(20rem, calc(100vw - 1.5rem))",
          maxWidth: "min(26rem, calc(100vw - 2rem))",
          overflowWrap: "break-word",
        },
      }}
    />
  );
}
