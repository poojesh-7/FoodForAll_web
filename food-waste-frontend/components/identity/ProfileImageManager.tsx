"use client";

import { useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    } catch (err) {
      setError(userService.getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <IdentityAvatar
          src={imageUrl}
          name={name}
          role={role}
          label={`${role ?? "User"} avatar`}
          size="lg"
        />
        <div>
          <p className="text-sm font-semibold text-zinc-950">Profile image</p>
          <p className="text-xs text-zinc-500">JPG, PNG, or WEBP up to 5 MB.</p>
          {error && <p className="mt-1 text-xs font-medium text-red-700">{error}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
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
          className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {imageUrl ? "Replace" : "Upload"}
        </button>
        {imageUrl && (
          <button
            type="button"
            onClick={() => void removeImage()}
            disabled={saving}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
