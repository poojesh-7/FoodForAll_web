"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getRegistrationRedirect } from "@/lib/onboarding";
import { ngoService } from "@/services/ngo.service";

type NGOForm = {
  organization_name: string;
  registration_number: string;
  service_radius_km: string;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

export default function NGORegisterPage() {
  const router = useRouter();

  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<NGOForm>({
    organization_name: "",
    registration_number: "",
    service_radius_km: "10",
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current) return;

    if (!form.organization_name.trim() || !form.registration_number.trim()) {
      setError("Organization name and registration number are required.");
      return;
    }

    try {
      submittingRef.current = true;
      setLoading(true);
      setError("");

      const position = await getCurrentPosition();
      const result = await ngoService.registerNGO({
        organization_name: form.organization_name.trim(),
        registration_number: form.registration_number.trim(),
        service_radius_km: form.service_radius_km,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      router.push(getRegistrationRedirect("ngo", result.ngo.is_verified));
    } catch (err) {
      submittingRef.current = false;
      setLoading(false);
      setError(ngoService.getErrorMessage(err));
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg space-y-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            Organization onboarding
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
            NGO Registration
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Provide organization information to participate in food rescue
            operations and community distribution.
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <label
            htmlFor="organization_name"
            className="block text-sm font-medium text-zinc-700"
          >
            Organization name
          </label>
          <input
            id="organization_name"
            value={form.organization_name}
            placeholder="Registered NGO name"
            disabled={loading}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
            onChange={(event) =>
              setForm({ ...form, organization_name: event.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="registration_number"
            className="block text-sm font-medium text-zinc-700"
          >
            Registration number
          </label>
          <input
            id="registration_number"
            value={form.registration_number}
            placeholder="Government registration number"
            disabled={loading}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
            onChange={(event) =>
              setForm({ ...form, registration_number: event.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="service_radius_km"
            className="block text-sm font-medium text-zinc-700"
          >
            Service radius
          </label>
          <input
            id="service_radius_km"
            value={form.service_radius_km}
            inputMode="decimal"
            placeholder="Service radius in km"
            disabled={loading}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
            onChange={(event) =>
              setForm({ ...form, service_radius_km: event.target.value })
            }
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Submit for Verification"}
        </button>
      </form>
    </main>
  );
}
