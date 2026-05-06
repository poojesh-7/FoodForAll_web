"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { authService } from "@/services/auth";
import { userService } from "@/services/user";
import { useAuthStore } from "@/store/authStore";
import type { UserProfile } from "@backend/contracts/api-contracts";

type ProfileForm = {
  name: string;
  email: string;
  profile_image: string;
  address: string;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

export default function ProfilePage() {
  const authUser = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const fetchMe = useAuthStore((state) => state.fetchMe);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    name: "",
    email: "",
    profile_image: "",
    address: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!authUser?.id) return;

    let active = true;

    userService
      .getUser(authUser.id)
      .then((result) => {
        if (!active) return;

        setProfile(result);
        setForm({
          name: result.name ?? "",
          email: result.email ?? "",
          profile_image: "",
          address: "",
        });
      })
      .catch((err) => {
        if (active) setError(userService.getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authUser?.id]);

  const saveProfile = async () => {
    if (!authUser?.id || saving) return;

    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      setSuccess("");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const updated = await userService.updateUser(authUser.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        profile_image: form.profile_image.trim() || null,
      });

      setProfile((current) =>
        current
          ? {
              ...current,
              name: updated.name,
              email: updated.email,
              role: updated.role,
            }
          : current
      );
      setUser({ ...authUser, ...updated });
      setSuccess("Profile updated successfully.");
    } catch (err) {
      setError(userService.getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const updateLocation = async () => {
    if (locationSaving) return;

    try {
      setLocationSaving(true);
      setError("");
      setSuccess("");

      const position = await getCurrentPosition();

      await authService.updateLocation({
        address: form.address.trim() || null,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      await fetchMe();

      setSuccess("Location updated successfully.");
    } catch (err) {
      setError(authService.getErrorMessage(err));
    } finally {
      setLocationSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
        Loading...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Profile</h1>
            <p className="text-sm text-zinc-600">
              View and update your account details.
            </p>
          </div>
          <LogoutButton />
        </div>

        {(error || success) && (
          <div className="space-y-2">
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {success}
              </p>
            )}
          </div>
        )}

        <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">Phone</p>
              <p className="text-sm text-zinc-950">{profile?.phone ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">Role</p>
              <p className="text-sm text-zinc-950">{profile?.role ?? "-"}</p>
            </div>
          </div>

          <input
            value={form.name}
            placeholder="Name"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />

          <input
            value={form.email}
            type="email"
            placeholder="Email"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />

          <input
            value={form.profile_image}
            placeholder="Profile image URL"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) =>
              setForm({ ...form, profile_image: event.target.value })
            }
          />

          <button
            onClick={saveProfile}
            disabled={saving}
            className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Location</h2>
          <input
            value={form.address}
            placeholder="Address"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) =>
              setForm({ ...form, address: event.target.value })
            }
          />
          <button
            onClick={updateLocation}
            disabled={locationSaving}
            className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locationSaving ? "Updating..." : "Use Current Location"}
          </button>
        </section>

        <Link
          href="/profile/history"
          className="block rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-zinc-950"
        >
          View History
        </Link>
      </div>
    </main>
  );
}
