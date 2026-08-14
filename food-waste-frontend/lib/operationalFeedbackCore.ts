export type OperationalFeedbackVariant =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "neutral";

const DEFAULT_DURATIONS: Record<OperationalFeedbackVariant, number> = {
  error: 9000,
  warning: 8000,
  success: 5000,
  info: 6000,
  neutral: 0,
};

export function normalizeOperationalFeedbackMessage(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

export function shouldNotifyOperationalFeedback(
  variant: OperationalFeedbackVariant,
  message: string
) {
  return variant !== "neutral" && normalizeOperationalFeedbackMessage(message).length > 0;
}

export function getOperationalFeedbackDuration(
  variant: OperationalFeedbackVariant,
  duration?: number
) {
  if (typeof duration === "number") return duration;
  return DEFAULT_DURATIONS[variant];
}

export function getOperationalFeedbackId({
  variant,
  message,
  scope,
}: {
  variant: OperationalFeedbackVariant;
  message: string;
  scope?: string;
}) {
  const normalized = normalizeOperationalFeedbackMessage(message).toLowerCase();
  return ["operational", scope, variant, normalized].filter(Boolean).join(":");
}
