const phonePattern = /^(?:[6-9]\d{9}|\+[1-9]\d{7,14}|91[6-9]\d{9})$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const placeholderValues = new Set([
  "asdf",
  "demo",
  "dummy",
  "example",
  "fake",
  "na",
  "n a",
  "n/a",
  "nil",
  "none",
  "not applicable",
  "null",
  "qwerty",
  "sample",
  "test",
  "testing",
  "undefined",
  "unknown",
  "your address",
  "your full name",
  "your name",
  "organization name",
  "restaurant name",
  "provider name",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function compactForGarbageCheck(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasLetters(value: string) {
  return /\p{L}/u.test(value);
}

function hasLettersOrNumbers(value: string) {
  return /[\p{L}\p{N}]/u.test(value);
}

function isGarbageText(value: string, allowDigitsOnly = false) {
  const normalized = compactForGarbageCheck(value);
  const compact = normalized.replace(/\s+/g, "");

  if (!normalized || placeholderValues.has(normalized)) return true;
  if (!hasLettersOrNumbers(value)) return true;
  if (!allowDigitsOnly && !hasLetters(value)) return true;
  if (compact.length >= 4 && new Set(compact).size <= 2) return true;

  return false;
}

function validateText(
  value: string,
  {
    field,
    minLength,
    maxLength,
    pattern,
    patternMessage,
    allowDigitsOnly = false,
  }: {
    field: string;
    minLength: number;
    maxLength: number;
    pattern?: RegExp;
    patternMessage?: string;
    allowDigitsOnly?: boolean;
  }
) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) return `${field} is required.`;
  if (normalized.length < minLength) {
    return `${field} must be at least ${minLength} characters.`;
  }
  if (normalized.length > maxLength) {
    return `${field} must be ${maxLength} characters or fewer.`;
  }
  if (isGarbageText(normalized, allowDigitsOnly)) {
    return `${field} must be meaningful.`;
  }
  if (pattern && !pattern.test(normalized)) {
    return patternMessage ?? `${field} format is invalid.`;
  }

  return "";
}

export function sanitizePhoneInput(value: string) {
  const compact = value.replace(/[^\d+]/g, "");
  const withoutExtraPlus = compact.startsWith("+")
    ? `+${compact.slice(1).replace(/\+/g, "")}`
    : compact.replace(/\+/g, "");

  return withoutExtraPlus.startsWith("+")
    ? withoutExtraPlus.slice(0, 16)
    : withoutExtraPlus.slice(0, 15);
}

export function validatePhone(value: string) {
  return phonePattern.test(value.trim())
    ? ""
    : "Enter a valid Indian or E.164 phone number.";
}

export function validateEmail(value: string) {
  const normalized = value.trim();
  if (!normalized) return "Email is required.";
  return emailPattern.test(normalized) ? "" : "Enter a valid email address.";
}

export function validatePersonName(value: string) {
  return validateText(value, {
    field: "Name",
    minLength: 2,
    maxLength: 100,
    pattern: /^[\p{L}][\p{L}\p{M} .'_-]{1,99}$/u,
    patternMessage:
      "Name can contain letters, spaces, apostrophes, periods, hyphens, and underscores.",
  });
}

export function validateBusinessName(value: string, field: string) {
  return validateText(value, {
    field,
    minLength: 2,
    maxLength: 150,
    pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &.,'()/_-]{1,149}$/u,
    patternMessage:
      `${field} can contain letters, numbers, spaces, and common business punctuation.`,
  });
}

export function validateAddress(value: string) {
  if (!value.trim()) return "";
  return validateText(value, {
    field: "Address",
    minLength: 5,
    maxLength: 300,
    pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} #,.'()/_-]{4,299}$/u,
    patternMessage:
      "Address can contain letters, numbers, spaces, and common address punctuation.",
    allowDigitsOnly: true,
  });
}

export function validateRequiredAddress(value: string) {
  return validateText(value, {
    field: "Address",
    minLength: 5,
    maxLength: 300,
    pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} #,.'()/_-]{4,299}$/u,
    patternMessage:
      "Address can contain letters, numbers, spaces, and common address punctuation.",
    allowDigitsOnly: true,
  });
}

export function validateRegistrationNumber(value: string) {
  return validateText(value, {
    field: "Registration number",
    minLength: 4,
    maxLength: 100,
    pattern: /^[A-Za-z0-9][A-Za-z0-9 ./_-]{3,99}$/,
    patternMessage:
      "Registration number can contain letters, numbers, spaces, slash, period, underscore, and hyphen.",
    allowDigitsOnly: true,
  });
}

export function validateFssaiNumber(value: string) {
  return /^\d{14}$/.test(value.replace(/[\s-]/g, ""))
    ? ""
    : "FSSAI number must be a 14 digit license number.";
}

export function validateServiceRadius(value: string) {
  const radius = Number(value);
  return Number.isInteger(radius) && radius >= 1 && radius <= 100
    ? ""
    : "Service radius must be a whole number between 1 and 100 km.";
}

export { phonePattern };
