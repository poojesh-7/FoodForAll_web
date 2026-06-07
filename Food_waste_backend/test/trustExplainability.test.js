const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAdminTrustActionEvent,
  effectImpact,
  normalizeAdminTrustAction,
} = require("../shared/services/trustExplainability.service");

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";

function eventFromAdminAction(action) {
  const event = buildAdminTrustActionEvent({
    actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    adminId: ADMIN_ID,
    subjectType: "provider",
    subjectId: PROVIDER_ID,
    reason: "Admin reviewed evidence",
    ...action,
  });

  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    event_key: event.eventKey,
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    source_type: event.sourceType,
    source_id: event.sourceId,
    event_type: event.eventType,
    event_payload: event.eventPayload,
    processing_status: "pending",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}

test("manual restriction action emits replay-safe explicit restriction event", () => {
  const event = eventFromAdminAction({
    actionType: "MANUAL_RESTRICTION",
    details: { restriction_level: 3 },
  });

  assert.equal(event.source_type, "admin_trust_action");
  assert.equal(event.event_type, "admin_manual_restriction");
  assert.equal(event.event_payload.restriction_level, 3);
  assert.equal(event.event_payload.score_delta, 0);
  assert.equal(event.event_payload.metadata.admin_id, ADMIN_ID);

  const impact = effectImpact(event);
  assert.deepEqual(impact.impact, ["Restriction level 3"]);
});

test("manual cooldown action normalizes future cooldown through existing payload fields", () => {
  const normalized = normalizeAdminTrustAction({
    actionType: "MANUAL_COOLDOWN",
    reason: "Temporary pause after review",
    currentRestrictionLevel: 1,
    details: {
      cooldown_until: "2099-01-01T00:00:00.000Z",
      restriction_level: 3,
    },
  });
  const event = eventFromAdminAction(normalized);

  assert.equal(event.event_type, "admin_manual_cooldown");
  assert.equal(event.event_payload.restriction_level, 3);
  assert.equal(event.event_payload.cooldown_until, "2099-01-01T00:00:00.000Z");
  assert.match(effectImpact(event).impact.join(" | "), /Cooldown until 2099/);
});

test("trust review flag remains audit-only with no projection impact", () => {
  const event = eventFromAdminAction({
    actionType: "TRUST_REVIEW_FLAG",
    details: { review_flag: true },
  });

  assert.equal(event.event_type, "admin_trust_review_flag");
  assert.equal(event.event_payload.analytics_only, true);
  assert.deepEqual(effectImpact(event).impact, ["Audit only"]);
});

test("manual recovery credit uses verified good behavior event path", () => {
  const event = eventFromAdminAction({
    actionType: "MANUAL_RECOVERY_CREDIT",
    details: {},
  });

  assert.equal(event.event_type, "verified_good_behavior");
  assert.equal(event.event_payload.score_delta, 2);
  assert.equal(event.event_payload.completion_delta, 1);
  assert.equal(
    event.event_payload.metadata.recovery_route,
    "admin_manual_recovery_credit"
  );
});
