"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  Clock3,
  History,
  MapPin,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";
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
import {
  getBrowserPushPermission,
  isBrowserPushSupported,
  requestBrowserPushSubscription,
  showBrowserPushError,
  showBrowserPushSuccess,
} from "@/lib/browserPush";

type ProfileForm = {
  name: string;
  email: string;
  address: string;
};

type RoleProfile = NGOProfile | RestaurantProfile;

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 read-only:border-zinc-200 read-only:bg-zinc-100 read-only:text-zinc-500";
const labelClass = "block text-sm font-medium text-zinc-700";
const sectionClass = "rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";

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

function formatRole(role: UserRole | null | undefined) {
  if (!role) return "Role not set";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function hasCoordinates(latitude: unknown, longitude: unknown) {
  return (
    latitude !== null &&
    latitude !== undefined &&
    latitude !== "" &&
    longitude !== null &&
    longitude !== undefined &&
    longitude !== ""
  );
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
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">(() => getBrowserPushPermission());
  const authEmail = getAuthEmail(authUser);
  const emailLocked = authUser?.auth_provider === "google" && Boolean(authEmail);
  const canManageBrowserNotifications = Boolean(authUser?.id && isBrowserPushSupported());

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
          address: accountProfile.address ?? "",
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

      const updatedLocation = await authService.updateLocation({
        address: form.address.trim() || null,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const refreshedUser = await fetchMe();
      const nextLocation = updatedLocation.user;
      setProfile((current) =>
        current
          ? {
              ...current,
              address: nextLocation.address,
              latitude: nextLocation.latitude,
              longitude: nextLocation.longitude,
            }
          : current
      );
      setForm((current) => ({
        ...current,
        address: nextLocation.address ?? refreshedUser?.address ?? "",
      }));
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

  const handleEnableNotifications = async () => {
    if (!canManageBrowserNotifications || permissionBusy) return;

    setPermissionBusy(true);

    try {
      const result = await requestBrowserPushSubscription();
      if (result.ok) {
        setBrowserPermission(getBrowserPushPermission());
        showBrowserPushSuccess("Notifications enabled on this browser.");
        return;
      }

      showBrowserPushError(result.message || "Notifications were not enabled.");
      setBrowserPermission(getBrowserPushPermission());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "We could not enable notifications right now.";
      showBrowserPushError(message);
    } finally {
      setPermissionBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-sm text-zinc-600">
        <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          Loading profile...
        </div>
      </main>
    );
  }

  const locationConfigured =
    Boolean(profile?.address) || hasCoordinates(profile?.latitude, profile?.longitude);

  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <header className="rounded-lg border border-emerald-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase text-emerald-700">
                Personal information
              </p>
              <h1 className="mt-1 break-words text-2xl font-semibold text-zinc-950 sm:text-3xl">
                Profile
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                View and update your account details.
              </p>
            </div>
            <div className="inline-flex w-full items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 sm:w-auto">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <span className="min-w-0 truncate">{formatRole(profile?.role)}</span>
            </div>
          </div>
        </header>

        {(error || success) && (
          <div className="space-y-2">
            {error && <OperationalFeedbackBlock title={error} tone="error" />}
            {success && <OperationalFeedbackBlock title={success} tone="success" />}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] lg:items-start">
          <section className={`${sectionClass} space-y-5`}>
            <div className="flex min-w-0 items-center gap-3 border-b border-zinc-100 pb-4">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-zinc-950">
                  Personal Information
                </h2>
                <p className="text-sm text-zinc-500">
                  {profile?.phone ?? "-"}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="profile-name" className={labelClass}>
                  Name
                </label>
                <input
                  id="profile-name"
                  value={form.name}
                  placeholder="Name"
                  className={inputClass}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="profile-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="profile-email"
                  value={form.email}
                  type="email"
                  placeholder="Email"
                  readOnly={emailLocked}
                  className={inputClass}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-zinc-500">Phone</p>
                <p className="mt-1 break-words text-sm font-medium text-zinc-950">
                  {profile?.phone ?? "-"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-zinc-500">Role</p>
                <p className="mt-1 text-sm font-medium text-zinc-950">
                  {formatRole(profile?.role)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={saveProfile}
              disabled={saving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </section>

          <section className={`${sectionClass} space-y-4`}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-zinc-950">
                  Profile Photo
                </h2>
                <p className="text-sm text-zinc-500">
                  {displayValue(profile?.name)}
                </p>
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
          </section>
        </div>

        {isNGOProfile(roleProfile) && (
          <section className={`${sectionClass} space-y-4`}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </span>
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
          <section className={`${sectionClass} space-y-4`}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </span>
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

        <div className="grid gap-5 lg:grid-cols-2">
          <section className={`${sectionClass} space-y-4`}>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                  <Bell className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-zinc-950">
                    Browser Notifications
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Status:{" "}
                    <span className="font-medium text-zinc-950">
                      {canManageBrowserNotifications
                        ? browserPermission === "granted"
                          ? "Enabled"
                          : "Not Enabled"
                        : "Unavailable"}
                    </span>
                  </p>
                </div>
              </div>
              {canManageBrowserNotifications && browserPermission !== "granted" && (
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  disabled={permissionBusy}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  {permissionBusy ? "Enabling..." : "Enable notifications"}
                </button>
              )}
            </div>
          </section>

          <section className={`${sectionClass} space-y-4`}>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                  <MapPin className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-zinc-950">Location</h2>
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">
                    {locationConfigured ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <Clock3 className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                    )}
                    <span>{locationConfigured ? "Configured" : "Not configured"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-address" className={labelClass}>
                Address
              </label>
              <input
                id="profile-address"
                value={form.address}
                placeholder="Address"
                className={inputClass}
                onChange={(event) =>
                  setForm({ ...form, address: event.target.value })
                }
              />
            </div>

            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs font-medium uppercase text-zinc-500">
                Coordinates
              </p>
              <p className="mt-1 break-words text-sm font-medium text-zinc-950">
                {displayCoordinates(profile?.latitude, profile?.longitude)}
              </p>
            </div>

            <button
              type="button"
              onClick={updateLocation}
              disabled={locationSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {locationSaving ? "Updating..." : "Use Current Location"}
            </button>
          </section>
        </div>

        <section className={`${sectionClass} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <History className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-zinc-950">History</h2>
              <p className="text-sm text-zinc-500">Reservations and listings</p>
            </div>
          </div>
          <Link
            href="/profile/history"
            className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 sm:w-auto"
          >
            View History
          </Link>
        </section>
      </div>
    </main>
  );
}
