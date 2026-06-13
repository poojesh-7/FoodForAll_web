const validator = require("validator");
const { normalizePhoneNumber } = require("./phone");
const {
  sanitizeOptionalText,
  sanitizePlainText,
} = require("../shared/utils/sanitize");

const PLACEHOLDER_VALUES = new Set([
  "a",
  "aa",
  "aaa",
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

function withValidationError(message, reason = "invalid_input") {
  const error = new Error(message);
  error.statusCode = 400;
  error.reason = reason;
  return error;
}

function compactForGarbageCheck(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasLetters(value) {
  return /[\p{L}]/u.test(value);
}

function hasLettersOrNumbers(value) {
  return /[\p{L}\p{N}]/u.test(value);
}

function isGarbageText(value, { allowDigitsOnly = false } = {}) {
  const normalized = compactForGarbageCheck(value);
  const compact = normalized.replace(/\s+/g, "");

  if (!normalized || PLACEHOLDER_VALUES.has(normalized)) return true;
  if (!hasLettersOrNumbers(value)) return true;
  if (!allowDigitsOnly && !hasLetters(value)) return true;

  if (compact.length >= 4) {
    const uniqueChars = new Set(compact).size;
    if (uniqueChars <= 2) return true;
    if (/^(.)\1{3,}$/u.test(compact)) return true;
  }

  return false;
}

function normalizeRequiredText(value, options = {}) {
  const {
    field = "Value",
    maxLength = 100,
    minLength = 2,
    pattern = null,
    patternMessage = `${field} format is invalid`,
    allowDigitsOnly = false,
    preserveNewlines = false,
  } = options;

  const normalized = sanitizePlainText(value, {
    maxLength: maxLength + 1,
    preserveNewlines,
  });

  if (!normalized) {
    throw withValidationError(`${field} is required`, "required");
  }

  if (normalized.length < minLength) {
    throw withValidationError(
      `${field} must be at least ${minLength} characters`,
      "too_short"
    );
  }

  if (normalized.length > maxLength) {
    throw withValidationError(
      `${field} must be ${maxLength} characters or fewer`,
      "too_long"
    );
  }

  if (isGarbageText(normalized, { allowDigitsOnly })) {
    throw withValidationError(`${field} must be meaningful`, "garbage_value");
  }

  if (pattern && !pattern.test(normalized)) {
    throw withValidationError(patternMessage, "invalid_format");
  }

  return normalized;
}

function normalizeOptionalText(value, options = {}) {
  const sanitized = sanitizeOptionalText(value, {
    maxLength: (options.maxLength || 1000) + 1,
    preserveNewlines: options.preserveNewlines,
  });

  if (!sanitized) return null;
  return normalizeRequiredText(sanitized, options);
}

function normalizePersonName(value) {
  return normalizeRequiredText(value, {
    field: "Name",
    minLength: 2,
    maxLength: 100,
    pattern: /^[\p{L}][\p{L}\p{M} .'_-]{1,99}$/u,
    patternMessage: "Name can contain letters, spaces, apostrophes, periods, hyphens, and underscores",
  });
}

function normalizeBusinessName(value, field = "Organization name") {
  return normalizeRequiredText(value, {
    field,
    minLength: 2,
    maxLength: 150,
    pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &.,'()/_-]{1,149}$/u,
    patternMessage:
      `${field} can contain letters, numbers, spaces, and common business punctuation`,
    allowDigitsOnly: false,
  });
}

function normalizeAddress(value) {
  return normalizeOptionalText(value, {
    field: "Address",
    minLength: 5,
    maxLength: 300,
    pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} #,.'()/_-]{4,299}$/u,
    patternMessage:
      "Address can contain letters, numbers, spaces, and common address punctuation",
    allowDigitsOnly: true,
  });
}

function normalizeRequiredAddress(value) {
  return normalizeRequiredText(value, {
    field: "Address",
    minLength: 5,
    maxLength: 300,
    pattern: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} #,.'()/_-]{4,299}$/u,
    patternMessage:
      "Address can contain letters, numbers, spaces, and common address punctuation",
    allowDigitsOnly: true,
  });
}

function normalizeRegistrationNumber(value) {
  return normalizeRequiredText(value, {
    field: "Registration number",
    minLength: 4,
    maxLength: 100,
    pattern: /^[A-Za-z0-9][A-Za-z0-9 ./_-]{3,99}$/,
    patternMessage:
      "Registration number can contain letters, numbers, spaces, slash, period, underscore, and hyphen",
    allowDigitsOnly: true,
  });
}

function normalizeFssaiNumber(value) {
  const normalized = String(value || "").replace(/[\s-]/g, "");

  if (!/^\d{14}$/.test(normalized)) {
    throw withValidationError(
      "FSSAI number must be a 14 digit license number",
      "invalid_fssai_number"
    );
  }

  return normalized;
}

function normalizeRequiredPhone(value) {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    throw withValidationError(
      "Enter a valid Indian or E.164 phone number",
      "invalid_phone"
    );
  }

  return normalized;
}

function normalizeServiceRadiusKm(value, fallback) {
  const raw = value === undefined || value === null || value === "" ? fallback : value;
  const radius = Number(raw);

  if (!Number.isInteger(radius) || radius < 1 || radius > 100) {
    throw withValidationError(
      "Service radius must be a whole number between 1 and 100 km",
      "invalid_service_radius"
    );
  }

  return radius;
}

function normalizeProfileImageUrl(value) {
  const normalized = sanitizeOptionalText(value, { maxLength: 500 });
  if (!normalized) return null;

  if (
    !validator.isURL(normalized, {
      protocols: ["http", "https"],
      require_protocol: true,
    })
  ) {
    throw withValidationError("Profile image must be a valid URL", "invalid_url");
  }

  return normalized;
}

module.exports = {
  normalizeAddress,
  normalizeBusinessName,
  normalizeFssaiNumber,
  normalizeOptionalText,
  normalizePersonName,
  normalizeProfileImageUrl,
  normalizeRegistrationNumber,
  normalizeRequiredAddress,
  normalizeRequiredPhone,
  normalizeRequiredText,
  normalizeServiceRadiusKm,
  withValidationError,
};
