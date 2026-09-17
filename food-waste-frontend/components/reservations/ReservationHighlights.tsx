import type { ReactNode } from "react";

type SignalTileProps = {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "amber" | "emerald" | "sky" | "red" | "zinc";
};

type MetaChipProps = {
  icon?: ReactNode;
  label: ReactNode;
  tone?: "default" | "amber" | "emerald" | "sky" | "red" | "zinc";
};

const toneClasses: Record<NonNullable<SignalTileProps["tone"]>, string> = {
  default: "border-zinc-200 bg-white text-zinc-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  red: "border-red-200 bg-red-50 text-red-700",
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

export function SignalTile({
  icon,
  label,
  value,
  detail,
  tone = "default",
}: SignalTileProps) {
  return (
    <div className={`rounded-md border p-3 sm:p-4 ${toneClasses[tone]}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase leading-4 tracking-wide">
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-1 break-words text-base font-semibold leading-tight text-zinc-950 sm:mt-2 sm:text-lg">
        {value}
      </div>
      {detail && <div className="mt-1 text-xs leading-4 sm:text-sm sm:leading-5">{detail}</div>}
    </div>
  );
}

export function MetaChip({ icon, label, tone = "zinc" }: MetaChipProps) {
  return (
    <span
      className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold [overflow-wrap:anywhere] ${toneClasses[tone]}`}
    >
      {icon}
      {label}
    </span>
  );
}
