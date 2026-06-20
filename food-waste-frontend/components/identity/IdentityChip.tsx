"use client";

import IdentityAvatar from "@/components/identity/IdentityAvatar";
import { Star } from "lucide-react";
import type { UserRole } from "@shared/contracts/api-contracts";

type IdentityChipProps = {
  src?: string | null;
  name?: string | null;
  role?: UserRole | "provider" | "ngo" | "volunteer" | "user" | string | null;
  label: string;
  caption?: string;
  rating?: number | string | null;
  reviewCount?: number | string | null;
  tone?: "default" | "amber";
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatRole(role: IdentityChipProps["role"]) {
  const text = displayValue(role).replace(/_/g, " ");
  if (text === "-") return "Member";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default function IdentityChip({
  src,
  name,
  role,
  label,
  caption,
  rating,
  reviewCount,
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
        <p className="truncate text-xs">
          {formatRole(role)}
          {caption ? ` - ${caption}` : ""}
        </p>
        {toNumber(reviewCount) !== null && toNumber(reviewCount)! > 0 && (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-zinc-600">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-hidden="true" />
            {toNumber(rating)?.toFixed(1) ?? "0.0"} ({toNumber(reviewCount)}{" "}
            {toNumber(reviewCount) === 1 ? "review" : "reviews"})
          </p>
        )}
      </div>
    </div>
  );
}
