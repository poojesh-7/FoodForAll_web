"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/axios";

export default function RestaurantRegisterPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    restaurant_name: "",
    fssai_number: "",
    service_radius_km: "5",
  });

  const [file, setFile] = useState<File | null>(null);

  const submit = async () => {
    if (!file) {
      alert("FSSAI certificate is required");
      return;
    }

    try {
      setLoading(true);

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const formData = new FormData();

            formData.append("restaurant_name", form.restaurant_name);
            formData.append("fssai_number", form.fssai_number);
            formData.append("service_radius_km", form.service_radius_km);
            formData.append("latitude", pos.coords.latitude.toString());
            formData.append("longitude", pos.coords.longitude.toString());

            // 🔥 IMPORTANT
            formData.append("fssai_certificate", file);

            await api.post("/restaurant/register", formData);

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

        <h1 className="text-xl font-semibold">Register Restaurant</h1>

        <input
          placeholder="Restaurant Name"
          className="w-full border p-3 rounded"
          onChange={(e) =>
            setForm({ ...form, restaurant_name: e.target.value })
          }
        />

        <input
          placeholder="FSSAI Number"
          className="w-full border p-3 rounded"
          onChange={(e) =>
            setForm({ ...form, fssai_number: e.target.value })
          }
        />

        <input
          placeholder="Service Radius (km)"
          className="w-full border p-3 rounded"
          onChange={(e) =>
            setForm({ ...form, service_radius_km: e.target.value })
          }
        />

        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
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