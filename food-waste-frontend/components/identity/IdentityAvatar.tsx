"use client";

/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import type { UserRole } from "@shared/contracts/api-contracts";

type IdentityAvatarProps = {
  src?: string | null;
  name?: string | null;
  role?: UserRole | "provider" | "ngo" | "volunteer" | "user" | string | null;
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const roleInitials: Record<string, string> = {
  user: "U",
  provider: "P",
  ngo: "N",
  volunteer: "V",
};

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-xl",
};

export function getProfileThumbnailUrl(
  url?: string | null,
  size = 96
): string | null {
  if (!url) return null;
  if (!url.includes("/image/upload/")) return url;

  return url.replace(
    "/image/upload/",
    `/image/upload/c_fill,w_${size},h_${size},g_face,f_auto,q_auto/`
  );
}

function getInitial(name?: string | null, role?: string | null) {
  const normalizedRole = String(role ?? "").toLowerCase();
  const roleInitial = roleInitials[normalizedRole];

  if (roleInitial) return roleInitial;

  const first = String(name ?? "").trim().charAt(0);
  return first ? first.toUpperCase() : "U";
}

export default function IdentityAvatar({
  src,
  name,
  role,
  label,
  size = "md",
  className = "",
}: IdentityAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const thumbnailUrl = useMemo(
    () => getProfileThumbnailUrl(src, size === "lg" ? 160 : 96),
    [size, src]
  );
  const initial = getInitial(name, role);
  const baseClasses = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-950 font-semibold text-white ${sizeClasses[size]} ${className}`;

  if (thumbnailUrl && failedSrc !== thumbnailUrl) {
    return (
      <span className={baseClasses}>
        <img
          src={thumbnailUrl}
          alt={label}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(thumbnailUrl)}
        />
      </span>
    );
  }

  return (
    <span className={baseClasses} aria-label={label} role="img">
      {initial}
    </span>
  );
}
