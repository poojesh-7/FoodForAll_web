"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authService } from "@/services/auth";
import ProfileImageManager from "@/components/identity/ProfileImageManager";
import { foodService } from "@/services/food.service";
import { ngoService } from "@/services/ngo.service";
import { userService } from "@/services/user";
import {
  validateAddress,
  validateEmail,
  validatePersonName,
} from "@/lib/validation";
import { useAuthStore } from "@/store/authStore";
import type {
  NGOProfile,
  RestaurantProfile,
  UserProfile,
  UserRole,
} from "@shared/contracts/api-contracts";

type ProfileForm = {
  name: string;
  email: string;
  address: string;
};

type RoleProfile = NGOProfile | RestaurantProfile;

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function displayRadius(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return `${String(value)} km`;
}

function displayCoordinates(
  latitude: unknown,
  longitude: unknown
) {
  if (
    latitude === null ||
    latitude === undefined ||
    latitude === "" ||
    longitude === null ||
    longitude === undefined ||
    longitude === ""
  ) {
    return "-";
  }

  return `${String(latitude)}, ${String(longitude)}`;
}

function getVerificationState(profile: RoleProfile | null) {
  if (!profile) return "-";
  if (profile.is_verified) return "Approved";
  if (profile.rejection_reason) return "Rejected";
  return "Pending";
}

function isNGOProfile(profile: RoleProfile | null): profile is NGOProfile {
  return Boolean(profile && "organization_name" in profile);
}

function isRestaurantProfile(
  profile: RoleProfile | null
): profile is RestaurantProfile {
  return Boolean(profile && "restaurant_name" in profile);
}

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

function getAuthEmail(user: ReturnType<typeof useAuthStore.getState>["user"]) {
  return user && "email" in user && user.email ? String(user.email) : "";
}

export default function ProfilePage() {
  const authUser = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const fetchMe = useAuthStore((state) => state.fetchMe);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roleProfile, setRoleProfile] = useState<RoleProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    name: "",
    email: "",
    address: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const authEmail = getAuthEmail(authUser);
  const emailLocked = authUser?.auth_provider === "google" && Boolean(authEmail);

  useEffect(() => {
    if (!authUser?.id) return;

    let active = true;
    const userId = authUser.id;
    const role = authUser.role as UserRole | null | undefined;

    async function loadProfile() {
      const accountProfile = await userService.getUser(userId);
      const specializedProfile =
        role === "ngo"
          ? await ngoService.getMyNGO()
          : role === "provider"
            ? await foodService.getMyRestaurant()
            : null;

      return { accountProfile, specializedProfile };
    }

    loadProfile()
      .then(({ accountProfile, specializedProfile }) => {
        if (!active) return;

        setProfile(accountProfile);
        setRoleProfile(specializedProfile);
        setForm({
          name: accountProfile.name ?? "",
          email: accountProfile.email ?? "",
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
  }, [authUser?.id, authUser?.role]);

  const saveProfile = async () => {
    if (!authUser?.id || saving) return;

    const nameError = validatePersonName(form.name);
    const emailError = validateEmail(form.email);

    if (nameError || emailError) {
      setError(nameError || emailError);
      setSuccess("");
      return;
    }

    if (emailLocked && authEmail && form.email.trim() !== authEmail) {
      setError("Google account email cannot be changed.");
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
      });

      setProfile((current) =>
        current
          ? {
              ...current,
              name: updated.name,
              email: updated.email,
              role: updated.role,
              profile_image_url: updated.profile_image_url,
              profile_image_public_id: updated.profile_image_public_id,
              profile_image: updated.profile_image,
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

      const addressError = validateAddress(form.address);

      if (addressError) {
        setError(addressError);
        setSuccess("");
        return;
      }

      const position = await getCurrentPosition();

      await authService.updateLocation({
        address: form.address.trim() || null,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      await fetchMe();
      setRoleProfile((current) =>
        current
          ? {
              ...current,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }
          : current
      );

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
        <header>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">Profile</h1>
            <p className="text-sm text-zinc-600">
              View and update your account details.
            </p>
          </div>
        </header>

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

          {authUser?.id && (
            <ProfileImageManager
              userId={authUser.id}
              imageUrl={profile?.profile_image_url ?? profile?.profile_image}
              name={profile?.name}
              role={profile?.role}
              onChange={(updated) => {
                setProfile((current) =>
                  current
                    ? {
                        ...current,
                        profile_image_url: updated.profile_image_url,
                        profile_image_public_id: updated.profile_image_public_id,
                        profile_image: updated.profile_image,
                      }
                    : current
                );
                setUser({ ...authUser, ...updated });
                setSuccess(
                  updated.profile_image_url
                    ? "Profile image updated successfully."
                    : "Profile image removed successfully."
                );
                setError("");
              }}
            />
          )}

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
            readOnly={emailLocked}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 read-only:bg-zinc-100"
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />

          <button
            onClick={saveProfile}
            disabled={saving}
            className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </section>

        {isNGOProfile(roleProfile) && (
          <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">NGO Details</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  NGO name
                </p>
                <p className="text-sm text-zinc-950">
                  {displayValue(roleProfile.organization_name)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Registration number
                </p>
                <p className="text-sm text-zinc-950">
                  {displayValue(roleProfile.registration_number)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Service radius
                </p>
                <p className="text-sm text-zinc-950">
                  {displayRadius(roleProfile.service_radius_km)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Verification
                </p>
                <p className="text-sm text-zinc-950">
                  {getVerificationState(roleProfile)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Urgent requests
                </p>
                <p className="text-sm text-zinc-950">
                  {displayValue(roleProfile.urgent_flag)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Location
                </p>
                <p className="text-sm text-zinc-950">
                  {displayCoordinates(
                    roleProfile.latitude,
                    roleProfile.longitude
                  )}
                </p>
              </div>
            </div>

            {roleProfile.rejection_reason && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {roleProfile.rejection_reason}
              </p>
            )}
          </section>
        )}

        {isRestaurantProfile(roleProfile) && (
          <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">
                Provider Details
              </h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Restaurant name
                </p>
                <p className="text-sm text-zinc-950">
                  {displayValue(roleProfile.restaurant_name)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  FSSAI number
                </p>
                <p className="text-sm text-zinc-950">
                  {displayValue(roleProfile.fssai_number)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Service radius
                </p>
                <p className="text-sm text-zinc-950">
                  {displayRadius(roleProfile.service_radius_km)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Verification
                </p>
                <p className="text-sm text-zinc-950">
                  {getVerificationState(roleProfile)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Certificate
                </p>
                {roleProfile.fssai_certificate_url ? (
                  <a
                    href={roleProfile.fssai_certificate_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-zinc-950 underline underline-offset-2"
                  >
                    View certificate
                  </a>
                ) : (
                  <p className="text-sm text-zinc-950">-</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Location
                </p>
                <p className="text-sm text-zinc-950">
                  {displayCoordinates(
                    roleProfile.latitude,
                    roleProfile.longitude
                  )}
                </p>
              </div>
            </div>

            {roleProfile.rejection_reason && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {roleProfile.rejection_reason}
              </p>
            )}
          </section>
        )}

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
