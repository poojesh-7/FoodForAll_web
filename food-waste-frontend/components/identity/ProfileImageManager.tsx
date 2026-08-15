"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import IdentityAvatar from "@/components/identity/IdentityAvatar";
import { userService } from "@/services/user";
import type {
  DbId,
  UserRole,
  UserUpdateResult,
} from "@shared/contracts/api-contracts";

const maxProfileImageBytes = 5 * 1024 * 1024;
const profileImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

type ProfileImageManagerProps = {
  userId: DbId;
  imageUrl?: string | null;
  name?: string | null;
  role?: UserRole | null;
  onChange: (profile: UserUpdateResult) => void;
};

function getValidationError(file: File) {
  if (!profileImageMimeTypes.has(file.type)) {
    return "Only JPG, PNG, or WEBP images are allowed.";
  }

  if (file.size > maxProfileImageBytes) {
    return "Profile image must be 5 MB or smaller.";
  }

  return null;
}

export default function ProfileImageManager({
  userId,
  imageUrl,
  name,
  role,
  onChange,
}: ProfileImageManagerProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refreshIdentitySurfaces = () => {
    router.refresh();
    window.location.reload();
  };

  const uploadImage = async (file: File) => {
    const validationError = getValidationError(file);

    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError("");
      const updated = await userService.uploadProfileImage(userId, file);
      onChange(updated);
      refreshIdentitySurfaces();
    } catch (err) {
      setError(userService.getErrorMessage(err));
    } finally {
      setSaving(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeImage = async () => {
    try {
      setSaving(true);
      setError("");
      const updated = await userService.removeProfileImage(userId);
      onChange(updated);
      refreshIdentitySurfaces();
    } catch (err) {
      setError(userService.getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-md border border-emerald-100 bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <IdentityAvatar
          src={imageUrl}
          name={name}
          role={role}
          label={`${role ?? "User"} avatar`}
          size="lg"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-950">Profile image</p>
          <p className="text-xs text-zinc-500">JPG, PNG, or WEBP up to 5 MB.</p>
          {error && <p className="mt-1 text-xs font-medium text-red-700">{error}</p>}
        </div>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadImage(file);
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={saving}
          className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {imageUrl ? "Replace" : "Upload"}
        </button>
        {imageUrl && (
          <button
            type="button"
            onClick={() => void removeImage()}
            disabled={saving}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
