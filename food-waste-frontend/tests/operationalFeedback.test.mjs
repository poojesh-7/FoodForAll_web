import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getOperationalFeedbackDuration,
  getOperationalFeedbackId,
  normalizeOperationalFeedbackMessage,
  shouldNotifyOperationalFeedback,
} from "../lib/operationalFeedbackCore.ts";

test("operational feedback ids dedupe identical messages", () => {
  const first = getOperationalFeedbackId({
    variant: "error",
    message: "User already has reservation for this listing.",
  });
  const second = getOperationalFeedbackId({
    variant: "error",
    message: "  User already has reservation   for this listing. ",
  });

  assert.equal(first, second);
});

test("operational feedback ignores empty and neutral messages", () => {
  assert.equal(shouldNotifyOperationalFeedback("error", "  "), false);
  assert.equal(shouldNotifyOperationalFeedback("neutral", "Loading reservations..."), false);
  assert.equal(shouldNotifyOperationalFeedback("success", "Reservation created."), true);
});

test("operational feedback variants keep important errors readable", () => {
  assert.equal(getOperationalFeedbackDuration("error"), 9000);
  assert.equal(getOperationalFeedbackDuration("warning"), 8000);
  assert.equal(getOperationalFeedbackDuration("success"), 5000);
  assert.equal(getOperationalFeedbackDuration("error", Infinity), Infinity);
  assert.equal(
    normalizeOperationalFeedbackMessage("Payment   was not completed.\nTry again."),
    "Payment was not completed. Try again."
  );
});

test("app toaster is globally positioned for fixed viewport feedback", () => {
  const toaster = readFileSync(new URL("../components/AppToaster.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(toaster, /position="top-right"/);
  assert.match(toaster, /containerClassName="operational-toaster"/);
  assert.match(toaster, /left:\s*"auto"/);
  assert.match(toaster, /zIndex:\s*70/);
  assert.match(css, /\.operational-toaster/);
  assert.match(css, /left:\s*auto !important/);
  assert.match(css, /safe-area-inset-top/);
  assert.doesNotMatch(css, /inset-x/);
  assert.match(css, /max-width:\s*min\(26rem, calc\(100vw - 2rem\)\)/);
});

test("toast UI supports variants, dismissal, and accessible announcement", () => {
  const feedback = readFileSync(
    new URL("../lib/operationalFeedback.tsx", import.meta.url),
    "utf8"
  );

  assert.match(feedback, /error:[\s\S]*Action failed/);
  assert.match(feedback, /warning:[\s\S]*Needs attention/);
  assert.match(feedback, /success:[\s\S]*Success/);
  assert.match(feedback, /toast\.dismiss\(toastState\.id\)/);
  assert.match(feedback, /aria-live/);
});

test("existing inline validation still feeds the shared operational block", () => {
  const createListing = readFileSync(
    new URL("../app/provider/listings/create/page.tsx", import.meta.url),
    "utf8"
  );
  const completeProfile = readFileSync(
    new URL("../app/complete-profile/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(createListing, /getFoodValidationError/);
  assert.match(createListing, /OperationalFeedbackBlock title=\{error\} tone="error"/);
  assert.match(completeProfile, /validateEmail/);
  assert.match(completeProfile, /OperationalFeedbackBlock/);
});

test("operational feedback block keeps operational messages floating-only", () => {
  const block = readFileSync(
    new URL("../components/OperationalFeedbackBlock.tsx", import.meta.url),
    "utf8"
  );

  assert.match(block, /if \(tone !== "neutral"\) \{\s*return null;\s*\}/);
  assert.match(block, /toneClasses\[tone\]/);
});
