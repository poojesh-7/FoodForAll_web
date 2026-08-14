"use client";

import {
  useOperationalFeedback,
  type OperationalFeedbackVariant,
} from "@/lib/operationalFeedback";

type OperationalFeedbackBlockProps = {
  title: string;
  description?: string;
  tone?: OperationalFeedbackVariant;
  notify?: boolean;
};

const toneClasses: Record<OperationalFeedbackVariant, string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  neutral: "border-zinc-200 bg-white text-zinc-600",
};

export default function OperationalFeedbackBlock({
  title,
  description,
  tone = "neutral",
  notify = true,
}: OperationalFeedbackBlockProps) {
  useOperationalFeedback({
    message: [title, description].filter(Boolean).join(" "),
    variant: tone,
    enabled: notify && tone !== "neutral",
  });

  if (tone !== "neutral") {
    return null;
  }

  return (
    <div className={`rounded-lg border p-5 text-sm shadow-sm ${toneClasses[tone]}`}>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 opacity-90">{description}</p>}
    </div>
  );
}
