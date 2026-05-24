const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const htmlTagPattern = /<[^>]*>/g;

type SanitizeTextOptions = {
  maxLength?: number;
  preserveNewlines?: boolean;
};

function normalizeWhitespace(value: string, preserveNewlines: boolean) {
  if (preserveNewlines) {
    return value
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n");
  }

  return value.replace(/\s+/g, " ");
}

export function sanitizeTextInput(value: string, options: SanitizeTextOptions = {}) {
  const { maxLength = 1000, preserveNewlines = false } = options;
  const sanitized = normalizeWhitespace(
    value.replace(htmlTagPattern, "").replace(controlCharacters, ""),
    preserveNewlines
  ).trim();

  return sanitized.slice(0, maxLength);
}

export function sanitizeOptionalTextInput(
  value: string,
  options: SanitizeTextOptions = {}
) {
  return sanitizeTextInput(value, options) || null;
}
