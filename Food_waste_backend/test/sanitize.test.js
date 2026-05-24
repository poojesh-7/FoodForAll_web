const assert = require("node:assert/strict");
const test = require("node:test");

const {
  sanitizeOptionalText,
  sanitizePlainText,
} = require("../shared/utils/sanitize");

test("sanitizePlainText strips markup while preserving safe copy", () => {
  const value = sanitizePlainText(" Fresh <script>alert(1)</script><b>meal</b> ", {
    maxLength: 100,
  });

  assert.equal(value, "Fresh meal");
});

test("sanitizeOptionalText preserves review newlines and length limits", () => {
  const value = sanitizeOptionalText("Line 1\n\n\nLine 2<img src=x onerror=alert(1)>", {
    maxLength: 12,
    preserveNewlines: true,
  });

  assert.equal(value, "Line 1\n\nLine");
});

test("sanitizeOptionalText returns null for empty unsafe input", () => {
  assert.equal(sanitizeOptionalText("<img src=x>"), null);
});
