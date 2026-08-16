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

const USER_FACING_MESSAGE_RULES: Array<{
  pattern: RegExp;
  message: string;
}> = [
  {
    pattern: /\buser already has reservation for this listing\b/i,
    message: "You've already reserved this food.",
  },
  {
    pattern: /\balready (has|have|made) (a )?reservation\b/i,
    message: "You've already reserved this food.",
  },
  {
    pattern: /\blisting (is )?(no longer available|has expired|not found)\b/i,
    message: "Sorry, this food is no longer available.",
  },
  {
    pattern: /\b(food )?listing not found\b/i,
    message: "Sorry, this food is no longer available.",
  },
  {
    pattern: /\b(not enough|insufficient) quantity\b/i,
    message: "Sorry, there isn't enough food available for this reservation.",
  },
  {
    pattern: /\b(reservation creation failed|failed to create reservation)\b/i,
    message: "We couldn't reserve this food. Please try again.",
  },
  {
    pattern: /\breservation cannot be cancelled after the cutoff\b/i,
    message: "This reservation can no longer be cancelled because the pickup time is too close.",
  },
  {
    pattern: /\b(payment hold expired|payment window expired)\b/i,
    message: "Your payment window expired, so the reservation wasn't completed.",
  },
  {
    pattern: /\bpayment session is unavailable\b/i,
    message: "We couldn't find this payment session. Please cancel this hold or try again later.",
  },
  {
    pattern: /\bthis payment hold has expired\b/i,
    message: "Your payment window expired, so the reservation wasn't completed.",
  },
  {
    pattern: /\bpayment was not completed\b/i,
    message: "The payment wasn't completed, so the reservation wasn't created.",
  },
  {
    pattern: /\bopening secure cashfree checkout\b/i,
    message: "Opening secure payment checkout...",
  },
  {
    pattern: /\bcashfree\b.*\b(failed|error|authentication|order|checkout)\b/i,
    message: "We couldn't start the payment. Please try again.",
  },
  {
    pattern: /\border creation failed\b/i,
    message: "We couldn't start the payment. Please try again.",
  },
  {
    pattern: /\bpayment verification failed\b/i,
    message: "We couldn't confirm your payment yet. Please check your reservation before trying again.",
  },
  {
    pattern: /\bpayment authentication failed\b/i,
    message: "We couldn't process the payment. Please try again.",
  },
  {
    pattern: /\bpayment confirmed by the backend\b/i,
    message: "Payment confirmed.",
  },
  {
    pattern: /\bpayment did not complete\. the backend state is shown below\b/i,
    message: "The payment did not complete. Please check the status below.",
  },
  {
    pattern: /\brefreshing backend payment state\b/i,
    message: "Refreshing payment status...",
  },
  {
    pattern: /\bverifying payment status from the backend\b/i,
    message: "Checking payment status...",
  },
  {
    pattern: /\bpayment is still pending\. we will keep showing the backend state here\b/i,
    message: "Payment is still pending. Please check back shortly.",
  },
  {
    pattern: /\b(payment order|reservation id|redirect url)\b/i,
    message: "We couldn't find the payment details. Please try again from your reservations.",
  },
  {
    pattern: /\b(listing creation failed|failed to create listing)\b/i,
    message: "We couldn't create the food listing. Please check the details and try again.",
  },
  {
    pattern: /\bprofile update failed\b/i,
    message: "We couldn't save your profile. Please try again.",
  },
  {
    pattern: /\binvalid phone number\b/i,
    message: "Please enter a valid phone number.",
  },
  {
    pattern: /\blocation update failed\b/i,
    message: "We couldn't update your location. Please try again.",
  },
  {
    pattern: /^unauthorized\.?$/i,
    message: "Please sign in to continue.",
  },
  {
    pattern: /^forbidden\.?$/i,
    message: "You don't have permission to do this.",
  },
  {
    pattern: /\bsession expired\b/i,
    message: "Your session has expired. Please sign in again.",
  },
  {
    pattern: /\bauthentication failed\b/i,
    message: "We couldn't sign you in. Please try again.",
  },
  {
    pattern: /\b(network error|network request failed|failed to fetch)\b/i,
    message: "We couldn't connect right now. Please check your internet connection and try again.",
  },
  {
    pattern: /\b(internal server error|server error\s*(\(\d+\))?|unexpected html response)\b/i,
    message: "Something went wrong on our side. Please try again shortly.",
  },
  {
    pattern: /\b(request failed with status code|http error|status code)\s*\d{3}\b/i,
    message: "Something went wrong. Please try again.",
  },
  {
    pattern: /\b(validation failed|bad request|invalid request|invalid payload)\b/i,
    message: "We couldn't complete that request. Please check the details and try again.",
  },
  {
    pattern: /\b(conflict|already processed|already taken)\b/i,
    message: "That action was already handled. Please refresh and try again.",
  },
  {
    pattern: /\b(timeout|timed out)\b/i,
    message: "This is taking longer than expected. Please try again.",
  },
  {
    pattern:
      /\b(api|endpoint|http|database|uuid|token|authorization|resource|payload|exception|stack trace)\b/i,
    message: "Something went wrong. Please try again.",
  },
];

export function getUserFacingNotificationMessage(message: string) {
  const normalized = normalizeOperationalFeedbackMessage(message);
  const rule = USER_FACING_MESSAGE_RULES.find(({ pattern }) => pattern.test(normalized));

  return rule?.message ?? normalized;
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
