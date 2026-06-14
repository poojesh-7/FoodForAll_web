export const PLATFORM_TIME_ZONE = "Asia/Kolkata";
export const PLATFORM_LOCALE = "en-IN";

type DateInput = string | number | Date | null | undefined;

type FormatOptions = {
  fallback?: string;
};

const ISO_DATE_TIME_PATTERN =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g;

function parseDate(value: DateInput) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWithOptions(
  value: DateInput,
  options: Intl.DateTimeFormatOptions,
  { fallback = "-" }: FormatOptions = {}
) {
  const date = parseDate(value);
  if (!date) return fallback;

  return new Intl.DateTimeFormat(PLATFORM_LOCALE, {
    timeZone: PLATFORM_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatPlatformDateTime(
  value: DateInput,
  options: FormatOptions = {}
) {
  return formatWithOptions(
    value,
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    },
    options
  );
}

export function formatDateTime(value: string | Date | null) {
  const date = parseDate(value);
  if (!date) return null;

  return new Intl.DateTimeFormat(PLATFORM_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PLATFORM_TIME_ZONE,
  })
    .format(date)
    .replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
}

export function formatDateTimeOrFallback(
  value: string | Date | null,
  fallback = "-"
) {
  return formatDateTime(value) ?? fallback;
}

export function formatVisibleDateTimes(value: string) {
  return value.replace(ISO_DATE_TIME_PATTERN, (match) => formatDateTime(match) ?? match);
}

export function formatPlatformDate(value: DateInput, options: FormatOptions = {}) {
  return formatWithOptions(
    value,
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
    options
  );
}

export function formatPlatformShortDate(
  value: DateInput,
  options: FormatOptions = {}
) {
  return formatWithOptions(
    value,
    {
      month: "short",
      day: "numeric",
    },
    options
  );
}

export function formatPlatformRelativeTime(value: DateInput, now = Date.now()) {
  const date = parseDate(value);
  if (!date) return "Just now";

  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatPlatformShortDate(date);
}
