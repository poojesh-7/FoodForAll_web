"use client";

import { useEffect } from "react";
import toast, { type Toast } from "react-hot-toast";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  getOperationalFeedbackDuration,
  getOperationalFeedbackId,
  normalizeOperationalFeedbackMessage,
  shouldNotifyOperationalFeedback,
  type OperationalFeedbackVariant,
} from "@/lib/operationalFeedbackCore";

type OperationalFeedbackInput = {
  message: string;
  variant: OperationalFeedbackVariant;
  title?: string;
  duration?: number;
  scope?: string;
};

const variantMeta: Record<
  Exclude<OperationalFeedbackVariant, "neutral">,
  {
    title: string;
    icon: LucideIcon;
    iconClassName: string;
    className: string;
  }
> = {
  error: {
    title: "Action failed",
    icon: AlertCircle,
    iconClassName: "text-red-600",
    className: "border-red-200 bg-red-50 text-red-950",
  },
  warning: {
    title: "Needs attention",
    icon: AlertTriangle,
    iconClassName: "text-amber-600",
    className: "border-amber-200 bg-amber-50 text-amber-950",
  },
  success: {
    title: "Success",
    icon: CheckCircle2,
    iconClassName: "text-emerald-600",
    className: "border-emerald-200 bg-emerald-50 text-emerald-950",
  },
  info: {
    title: "Update",
    icon: Info,
    iconClassName: "text-sky-600",
    className: "border-sky-200 bg-sky-50 text-sky-950",
  },
};

function OperationalToast({
  toastState,
  message,
  title,
  variant,
}: {
  toastState: Toast;
  message: string;
  title?: string;
  variant: Exclude<OperationalFeedbackVariant, "neutral">;
}) {
  const meta = variantMeta[variant];
  const Icon = meta.icon;
  const role = variant === "error" ? "alert" : "status";

  return (
    <div
      role={role}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={`operational-toast pointer-events-auto flex w-[min(26rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg transition ${
        toastState.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      } ${meta.className}`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.iconClassName}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-5">{title || meta.title}</p>
        <p className="mt-1 break-words leading-5">{message}</p>
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(toastState.id)}
        aria-label="Dismiss notification"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 outline-none transition hover:bg-white/70 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function showOperationalFeedback(input: OperationalFeedbackInput) {
  const message = normalizeOperationalFeedbackMessage(input.message);

  if (!shouldNotifyOperationalFeedback(input.variant, message)) {
    return null;
  }

  const variant = input.variant === "neutral" ? "info" : input.variant;
  const id = getOperationalFeedbackId({
    variant,
    message,
    scope: input.scope,
  });

  toast.custom(
    (toastState) => (
      <OperationalToast
        toastState={toastState}
        message={message}
        title={input.title}
        variant={variant}
      />
    ),
    {
      id,
      duration: getOperationalFeedbackDuration(variant, input.duration),
      ariaProps: {
        role: variant === "error" ? "alert" : "status",
        "aria-live": variant === "error" ? "assertive" : "polite",
      },
    }
  );

  return id;
}

export function useOperationalFeedback(input: OperationalFeedbackInput & {
  enabled?: boolean;
}) {
  const {
    enabled = true,
    message,
    variant,
    title,
    duration,
    scope,
  } = input;

  useEffect(() => {
    if (!enabled) return;
    showOperationalFeedback({ message, variant, title, duration, scope });
  }, [duration, enabled, message, scope, title, variant]);
}

export type { OperationalFeedbackVariant };
