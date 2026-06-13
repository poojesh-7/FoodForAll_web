"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPostAuthRedirect } from "@/lib/onboarding";
import {
  sanitizePhoneInput,
  validateEmail,
  validatePersonName,
  validatePhone,
  validateRequiredAddress,
} from "@/lib/validation";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@shared/contracts/api-contracts";

type CompleteProfileForm = {
  phone: string;
  name: string;
  email: string;
  address: string;
  useCurrentLocation: boolean;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

function getUserStringField(
  user: ReturnType<typeof useAuthStore.getState>["user"],
  field: "phone" | "name" | "email"
) {
  if (!user) return "";

  if (field === "phone") {
    return "phone" in user && user.phone ? String(user.phone) : "";
  }

  if (field === "name") {
    return "name" in user && user.name ? String(user.name) : "";
  }

  return "email" in user && user.email ? String(user.email) : "";
}

function isProfileRole(role: UserRole | null | undefined) {
  return role === "user" || role === "volunteer" || role === "provider" || role === "ngo";
}

function getProfileOnboardingCopy(role: UserRole | null | undefined) {
  if (role === "volunteer") {
    return {
      step: "Volunteer onboarding",
      title: "Volunteer Registration",
      description:
        "Help transport rescued food from providers to recipients and support local food rescue efforts.",
    };
  }

  if (role === "provider") {
    return {
      step: "Provider onboarding",
      title: "Complete Your Provider Profile",
      description:
        "Add your operational contact details before submitting provider verification.",
    };
  }

  if (role === "ngo") {
    return {
      step: "NGO onboarding",
      title: "Complete Your Organization Contact",
      description:
        "Add your operational contact details before submitting NGO verification.",
    };
  }

  return {
    step: "Profile setup",
    title: "Complete Your Profile",
    description:
      "Tell us a little about yourself so we can personalize your FoodForAll experience.",
  };
}

export default function CompleteProfilePage() {
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const authError = useAuthStore((state) => state.authError);
  const authSuccess = useAuthStore((state) => state.authSuccess);
  const completeProfile = useAuthStore((state) => state.completeProfile);
  const clearMessages = useAuthStore((state) => state.clearMessages);
  const userPhone = getUserStringField(user, "phone");
  const userName = getUserStringField(user, "name");
  const userEmail = getUserStringField(user, "email");

  const [form, setForm] = useState<CompleteProfileForm>(() => ({
    phone: userPhone,
    name: userName,
    email: userEmail,
    address: "",
    useCurrentLocation: true,
  }));
  const [formError, setFormError] = useState("");
  const onboardingCopy = getProfileOnboardingCopy(user?.role);
  const emailLocked = Boolean(userEmail);

  useEffect(() => {
    if (!user?.role) {
      router.replace(getPostAuthRedirect(user));
      return;
    }

    if (!isProfileRole(user.role)) {
      router.replace(getPostAuthRedirect(user));
    }
  }, [router, user]);

  const submit = async () => {
    if (loading) return;

    if (!user?.role || !isProfileRole(user.role)) {
      router.replace(getPostAuthRedirect(user));
      return;
    }

    const phoneError = validatePhone(form.phone);
    const nameError = validatePersonName(form.name);
    const emailError = validateEmail(form.email);
    const addressError = validateRequiredAddress(form.address);

    if (phoneError || nameError || emailError || addressError) {
      setFormError(phoneError || nameError || emailError || addressError);
      return;
    }

    if (emailLocked && userEmail && form.email.trim() !== userEmail) {
      setFormError("Use the email from your Google account.");
      return;
    }

    try {
      setFormError("");
      clearMessages();

      const position = form.useCurrentLocation ? await getCurrentPosition() : null;
      const updatedUser = await completeProfile({
        phone: sanitizePhoneInput(form.phone),
        name: form.name.trim(),
        email: form.email.trim(),
        role: user.role,
        address: form.address.trim(),
        latitude: position?.coords.latitude ?? null,
        longitude: position?.coords.longitude ?? null,
      });

      if (updatedUser) {
        router.push(getPostAuthRedirect(updatedUser));
      }
    } catch {
      setFormError("Please allow location access or turn off location sharing.");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-lg space-y-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            {onboardingCopy.step}
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
            {onboardingCopy.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            {onboardingCopy.description}
          </p>
        </div>

        {(formError || authError || authSuccess) && (
          <div className="space-y-2">
            {(formError || authError) && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError || authError}
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
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Name
          </label>
          <input
            id="name"
            value={form.name}
            placeholder="Your full name"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
            Email
          </label>
          <input
            id="email"
            value={form.email}
            type="email"
            placeholder="you@example.com"
            readOnly={emailLocked}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 read-only:bg-zinc-100"
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="phone" className="block text-sm font-medium text-zinc-700">
            Phone number
          </label>
          <input
            id="phone"
            value={form.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={16}
            placeholder="9999999999 or +919999999999"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) =>
              setForm({
                ...form,
                phone: sanitizePhoneInput(event.target.value),
              })
            }
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="address"
            className="block text-sm font-medium text-zinc-700"
          >
            Address
          </label>
          <input
            id="address"
            value={form.address}
            placeholder="Pickup or delivery area"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => setForm({ ...form, address: event.target.value })}
          />
        </div>

        <label className="flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={form.useCurrentLocation}
            className="mt-1"
            onChange={(event) =>
              setForm({ ...form, useCurrentLocation: event.target.checked })
            }
          />
          <span>
            <span className="block font-medium text-zinc-950">
              Use my current location
            </span>
            <span className="mt-1 block text-zinc-600">
              This helps match nearby food, NGOs, and pickup activity.
            </span>
          </span>
        </label>

        <button
          onClick={submit}
          disabled={loading}
          className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </main>
  );
}
