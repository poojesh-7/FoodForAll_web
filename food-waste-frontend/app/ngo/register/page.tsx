"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/axios";

export default function NGORegisterPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    organization_name: "",
    registration_number: "",
    service_radius_km: "10",
  });

  const submit = async () => {
    try {
      setLoading(true);

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await api.post("/ngo/register", {
              organization_name: form.organization_name,
              registration_number: form.registration_number,
              service_radius_km: form.service_radius_km,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });

            router.push("/pending-verification");

          } catch (err: any) {
            alert(err?.response?.data?.error || "Registration failed");
            setLoading(false);
          }
        },
        () => {
          alert("Please allow location access");
          setLoading(false);
        }
      );

    } catch {
      alert("Something went wrong");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border p-6 rounded-xl space-y-4">

        <h1 className="text-xl font-semibold">Register NGO</h1>

        <input
          placeholder="Organization Name"
          className="w-full border p-3 rounded"
          onChange={(e) =>
            setForm({ ...form, organization_name: e.target.value })
          }
        />

        <input
          placeholder="Registration Number"
          className="w-full border p-3 rounded"
          onChange={(e) =>
            setForm({ ...form, registration_number: e.target.value })
          }
        />

        <input
          placeholder="Service Radius (km)"
          className="w-full border p-3 rounded"
          onChange={(e) =>
            setForm({ ...form, service_radius_km: e.target.value })
          }
        />

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-black text-white p-3 rounded"
        >
          {loading ? "Submitting..." : "Submit"}
        </button>

      </div>
    </div>
  );
}