"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

type LoginFormValues = {
  phone: string;
  otp: string;
};

const phonePattern = /^\d{10}$/;
const otpPattern = /^\d{4,6}$/;

function getSafeNextPath() {
  if (typeof window === "undefined") return null;

  const nextPath = new URLSearchParams(window.location.search).get("next");
  return nextPath?.startsWith("/") ? nextPath : null;
}

export default function LoginPage() {
  const router = useRouter();
  const [otpSent, setOtpSent] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [phoneValue, setPhoneValue] = useState("");
  const [otpValue, setOtpValue] = useState("");

  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const authError = useAuthStore((state) => state.authError);
  const authSuccess = useAuthStore((state) => state.authSuccess);
  const sendOtp = useAuthStore((state) => state.sendOtp);
  const verifyOtp = useAuthStore((state) => state.verifyOtp);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const {
    register,
    handleSubmit,
    trigger,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<LoginFormValues>({
    mode: "onTouched",
    defaultValues: {
      phone: "",
      otp: "",
    },
  });

  useEffect(() => {
    clearMessages();
  }, [clearMessages]);

  useEffect(() => {
    if (!user?.id) return;

    const redirectPath = getPostAuthRedirect(user);
    router.replace(
      redirectPath === "/dashboard" ? getSafeNextPath() ?? redirectPath : redirectPath
    );
  }, [router, user]);

  const phoneInput = register("phone", {
    required: "Phone number is required.",
    pattern: {
      value: phonePattern,
      message: "Enter a valid 10-digit phone number.",
    },
    onChange: (event) => {
      const value = event.target.value.replace(/\D/g, "").slice(0, 10);
      setValue("phone", value, { shouldDirty: true, shouldValidate: true });
      setValue("otp", "", { shouldDirty: true, shouldValidate: false });
      setPhoneValue(value);
      setOtpValue("");
      setOtpSent(false);
      clearMessages();
    },
  });

  const otpInput = register("otp", {
    required: "OTP is required.",
    pattern: {
      value: otpPattern,
      message: "Enter the 4 to 6 digit OTP.",
    },
    onChange: (event) => {
      const value = event.target.value.replace(/\D/g, "").slice(0, 6);
      setValue("otp", value, { shouldDirty: true, shouldValidate: true });
      setOtpValue(value);
      clearMessages();
    },
  });

  const handleSendOtp = async () => {
    clearMessages();
    const isValid = await trigger("phone");

    if (!isValid) return;

    const sent = await sendOtp(getValues("phone"));

    if (sent) {
      setOtpSent(true);
      setValue("otp", "", { shouldDirty: false, shouldValidate: false });
      setOtpValue("");
    }
  };

  const handleVerifyOtp = async (values: LoginFormValues) => {
    clearMessages();
    const result = await verifyOtp(values);

    if (!result) return;

    setRedirecting(true);

    const redirectPath = getPostAuthRedirect(result.user);
    router.push(
      redirectPath === "/dashboard" ? getSafeNextPath() ?? redirectPath : redirectPath
    );
  };

  const busy = loading || redirecting;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <form
        onSubmit={handleSubmit(handleVerifyOtp)}
        className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">Login</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Sign in with your phone number.
          </p>
        </div>

        {(authError || authSuccess) && (
          <div aria-live="polite" className="space-y-2">
            {authError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {authError}
              </p>
            )}

            {authSuccess && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {authSuccess}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-zinc-700"
          >
            Phone number
          </label>
          <input
            {...phoneInput}
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={10}
            placeholder="9999999999"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
            disabled={busy}
          />
          {errors.phone && (
            <p className="text-sm text-red-600">{errors.phone.message}</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleSendOtp}
          disabled={busy || !phonePattern.test(phoneValue)}
          className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && !otpSent ? "Sending..." : "Send OTP"}
        </button>

        {otpSent && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="otp"
                className="block text-sm font-medium text-zinc-700"
              >
                OTP
              </label>
              <input
                {...otpInput}
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="Enter OTP"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
                disabled={busy}
              />
              {errors.otp && (
                <p className="text-sm text-red-600">{errors.otp.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={busy || !otpPattern.test(otpValue)}
              className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Verifying..." : "Verify OTP"}
            </button>
          </div>
        )}
      </form>
    </main>
  );
}
