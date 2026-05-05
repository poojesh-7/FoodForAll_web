"use client";

import { useState } from "react";
import api from "@/lib/axios";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const router = useRouter();

  const sendOTP = async () => {
      try {
        setLoading(true);

        await api.post("/auth/send-otp", {
          phone,
        });

        setOtpSent(true);

        alert("OTP sent successfully");

      } catch (err: any) {
        console.error(err);

        alert(
          err?.response?.data?.error ||
          "Failed to send OTP"
        );

      } finally {
        setLoading(false);
      }
    };

   const verifyOTP = async () => {
      try {
        setLoading(true);

        const res = await api.post("/auth/verify-otp", { phone, otp });

        // ✅ Save phone to localStorage for authenticated routes
        localStorage.setItem("phone", phone);

        // ✅ NEW USER → go select role
        if (res.data.isNewUser) {
          router.push("/select-role");
          return;
        }

        // ✅ EXISTING USER → go to dashboard
        // (dashboard will handle role logic)
        router.push("/dashboard");

      } catch (err: any) {
        console.error(err);

        alert(
          err?.response?.data?.error ||
          "OTP verification failed"
        );
      } finally {
        setLoading(false);
      }
    };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">

      <div className="w-full max-w-md border rounded-xl p-6 space-y-4">

        <h1 className="text-2xl font-semibold">
          Login
        </h1>

        <input
          type="tel"
          placeholder="Enter phone number"
          className="w-full border p-3 rounded-lg outline-none"
          value={phone}
          maxLength={10}
          onChange={(e) =>
            setPhone(
              e.target.value.replace(/\D/g, "")
            )
          }
        />

        <button
          onClick={sendOTP}
          disabled={
            loading ||
            phone.length !== 10
          }
          className="w-full bg-black text-white p-3 rounded-lg disabled:opacity-50"
        >
          {loading
            ? "Sending..."
            : "Send OTP"}
        </button>

        {otpSent && (
          <>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Enter OTP"
              className="w-full border p-3 rounded-lg outline-none"
              value={otp}
              maxLength={6}
              onChange={(e) =>
                setOtp(
                  e.target.value.replace(/\D/g, "")
                )
              }
            />

            <button
              onClick={verifyOTP}
              disabled={
                loading ||
                otp.length < 4
              }
              className="w-full bg-black text-white p-3 rounded-lg disabled:opacity-50"
            >
              {loading
                ? "Verifying..."
                : "Verify OTP"}
            </button>
          </>
        )}

      </div>

    </div>
  );
}