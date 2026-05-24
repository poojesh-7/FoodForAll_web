const sanitizeHtml = require("sanitize-html");

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function normalizeWhitespace(value, preserveNewlines) {
  if (preserveNewlines) {
    return value
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n");
  }

  return value.replace(/\s+/g, " ");
}

function sanitizePlainText(value, options = {}) {
  const {
    maxLength = 1000,
    preserveNewlines = false,
  } = options;

  if (value === null || value === undefined) return "";

  const withoutMarkup = sanitizeHtml(String(value), {
    allowedAttributes: {},
    allowedTags: [],
    disallowedTagsMode: "discard",
  });
  const normalized = normalizeWhitespace(
    withoutMarkup.replace(CONTROL_CHARACTERS, ""),
    preserveNewlines
  ).trim();

  return normalized.slice(0, maxLength);
}

function sanitizeOptionalText(value, options = {}) {
  const sanitized = sanitizePlainText(value, options);
  return sanitized || null;
}

module.exports = {
  sanitizeOptionalText,
  sanitizePlainText,
};
