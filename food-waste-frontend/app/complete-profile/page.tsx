"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import api from "@/lib/axios";

export default function CompleteProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "user",
    address: "",
  });

  const submit = async () => {
    if (loading) return;

    const phone = localStorage.getItem("phone");

    if (!phone) {
      alert("Session expired. Please login again.");
      router.push("/login");
      return;
    }

    try {
      setLoading(true);

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await api.post("/auth/complete-profile", {
              phone,
              name: form.name,
              email: form.email,
              role: form.role,
              address: form.address,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });

            // ✅ cleanup temporary data
            localStorage.removeItem("phone");

            // ✅ cookies already set by backend
            router.push("/dashboard");

          } catch (err: any) {
            console.error(err);

            alert(
              err?.response?.data?.error ||
              "Profile completion failed"
            );

            setLoading(false);
          }
        },

        (geoError) => {
          console.error(geoError);

          alert("Please allow location access");

          setLoading(false);
        }
      );

    } catch (err) {
      console.error(err);

      alert("Something went wrong");

      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border rounded-xl p-6 space-y-4">

        <h1 className="text-2xl font-semibold">
          Complete Profile
        </h1>

        <input
          placeholder="Name"
          className="w-full border p-3 rounded-lg"
          onChange={(e) =>
            setForm({
              ...form,
              name: e.target.value,
            })
          }
        />

        <input
          placeholder="Email"
          className="w-full border p-3 rounded-lg"
          onChange={(e) =>
            setForm({
              ...form,
              email: e.target.value,
            })
          }
        />

        <select
          className="w-full border p-3 rounded-lg"
          onChange={(e) =>
            setForm({
              ...form,
              role: e.target.value,
            })
          }
        >
          <option value="user">User</option>
          <option value="volunteer">Volunteer</option>
        </select>

        <input
          placeholder="Address"
          className="w-full border p-3 rounded-lg"
          onChange={(e) =>
            setForm({
              ...form,
              address: e.target.value,
            })
          }
        />

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-black text-white p-3 rounded-lg disabled:opacity-50"
        >
          {loading ? "Please wait..." : "Continue"}
        </button>

      </div>
    </div>
  );
}