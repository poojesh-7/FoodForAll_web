"use client";

import IdentityAvatar from "@/components/identity/IdentityAvatar";
import type { UserRole } from "@shared/contracts/api-contracts";

type IdentityChipProps = {
  src?: string | null;
  name?: string | null;
  role?: UserRole | "provider" | "ngo" | "volunteer" | "user" | string | null;
  label: string;
  caption?: string;
  tone?: "default" | "amber";
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export default function IdentityChip({
  src,
  name,
  role,
  label,
  caption,
  tone = "default",
}: IdentityChipProps) {
  const toneClasses =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-zinc-200 bg-white text-zinc-600";

  return (
    <div className={`flex items-center gap-2 rounded-md border p-2 ${toneClasses}`}>
      <IdentityAvatar src={src} name={name} role={role} label={label} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-950">
          {displayValue(name)}
        </p>
        {caption && <p className="truncate text-xs">{caption}</p>}
      </div>
    </div>
  );
}
