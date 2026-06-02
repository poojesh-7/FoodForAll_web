const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertTrustActionAllowed,
  calculateDepositAmount,
  getTrustEnforcementPolicy,
  recordReservationLifecycleTrustEvents,
  recordVerifiedGoodBehavior,
} = require("../shared/services/trustEnforcement.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const NGO_ID = "44444444-4444-4444-8444-444444444444";
const VOLUNTEER_ID = "55555555-5555-4555-8555-555555555555";
const PAYMENT_ID = "66666666-6666-4666-8666-666666666666";
const RESERVATION_ID = "77777777-7777-4777-8777-777777777777";
const LISTING_ID = "88888888-8888-4888-8888-888888888888";

function createPolicyClient(scoreRow = null) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql: String(sql), params });
      if (String(sql).includes("FROM trust_scores")) {
        return { rows: scoreRow ? [scoreRow] : [] };
      }
      return { rows: [] };
    },
  };
}

function createReservationClient(row) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql: String(sql), params });
      if (String(sql).includes("FROM reservations r")) {
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
}

test("trust enforcement defaults to unrestricted policy when no projection exists", async () => {
  const client = createPolicyClient();
  const policy = await getTrustEnforcementPolicy({
    client,
    userId: USER_ID,
    role: "user",
    foodCost: 100,
  });

  assert.equal(policy.canReserve, true);
  assert.equal(policy.requiresDeposit, false);
  assert.equal(policy.depositAmount, 0);
  assert.equal(policy.trustScore, 100);
  assert.equal(policy.source, "trust_scores");
  assert.ok(client.queries.every((query) => !query.sql.includes("FROM users")));
});

test("trust enforcement blocks active cooldowns from projected cooldown_until", async () => {
  const client = createPolicyClient({
    subject_type: "user",
    subject_id: USER_ID,
    trust_score: 70,
    penalty_level: 4,
    projected_restriction_level: 3,
    projected_cooldown_until: new Date("2099-01-01T00:00:00.000Z"),
    projected_deposit_multiplier: 2,
    risk_category: "high",
  });

  const policy = await getTrustEnforcementPolicy({
    client,
    userId: USER_ID,
    role: "user",
    foodCost: 200,
  });

  assert.equal(policy.canReserve, false);
  assert.equal(policy.cooldownUntil.toISOString(), "2099-01-01T00:00:00.000Z");
  assert.match(policy.restrictionReason, /Trust cooldown active/);
  assert.equal(policy.requiresDeposit, true);
});

test("trust enforcement escalates deposits using projected deposit multiplier", async () => {
  const client = createPolicyClient({
    subject_type: "user",
    subject_id: USER_ID,
    trust_score: 84,
    penalty_level: 2,
    projected_restriction_level: 2,
    projected_deposit_multiplier: 1.5,
  });

  const policy = await getTrustEnforcementPolicy({
    client,
    userId: USER_ID,
    role: "user",
    foodCost: 200,
  });

  assert.equal(policy.canReserve, true);
  assert.equal(policy.requiresDeposit, true);
  assert.equal(policy.depositMultiplier, 1.5);
  assert.equal(policy.depositAmount, 60);
  assert.equal(calculateDepositAmount({
    role: "ngo",
    restrictionLevel: 2,
    depositMultiplier: 1.5,
  }), 150);
});

test("trust enforcement blocks manual-review restriction levels", async () => {
  const client = createPolicyClient({
    subject_type: "user",
    subject_id: USER_ID,
    trust_score: 35,
    penalty_level: 9,
    projected_restriction_level: 5,
    projected_deposit_multiplier: 3,
  });

  const policy = await getTrustEnforcementPolicy({
    client,
    userId: USER_ID,
    role: "user",
    foodCost: 100,
  });

  assert.equal(policy.canReserve, false);
  assert.throws(
    () => assertTrustActionAllowed(policy, "reserve"),
    /Manual trust review required/
  );
});

test("trust enforcement keeps level 4 volunteer task access recoverable", async () => {
  const client = createPolicyClient({
    subject_type: "volunteer",
    subject_id: VOLUNTEER_ID,
    trust_score: 55,
    penalty_level: 6,
    projected_restriction_level: 4,
    projected_deposit_multiplier: 3,
  });

  const policy = await getTrustEnforcementPolicy({
    client,
    userId: VOLUNTEER_ID,
    role: "volunteer",
  });

  assert.equal(policy.canTakeTask, true);
  assert.equal(policy.canReserve, true);
});

test("trust enforcement blocks critical volunteers from task access", async () => {
  const client = createPolicyClient({
    subject_type: "volunteer",
    subject_id: VOLUNTEER_ID,
    trust_score: 40,
    penalty_level: 14,
    projected_restriction_level: 5,
    projected_deposit_multiplier: 3,
    risk_state: {
      restriction_trigger_source: "penalty",
      blocked_actor_recovery_status: {
        deterministic_recovery_route: "verified_good_behavior",
      },
    },
  });

  const policy = await getTrustEnforcementPolicy({
    client,
    userId: VOLUNTEER_ID,
    role: "volunteer",
  });

  assert.equal(policy.canTakeTask, false);
  assert.equal(policy.blockedActorRecoveryStatus.deterministic_recovery_route, "verified_good_behavior");
  assert.throws(
    () => assertTrustActionAllowed(policy, "take_task"),
    /Manual trust review required/
  );
});

test("reservation lifecycle enforcement emits deterministic cancellation trust events", async () => {
  const appended = [];
  const client = createReservationClient({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    listing_id: LISTING_ID,
    pickup_type: "self_pickup",
    status: "cancelled",
    task_status: "self_pickup",
    payment_status: "refund_pending",
    payment_id: PAYMENT_ID,
  });

  const results = await recordReservationLifecycleTrustEvents({
    client,
    reservationId: RESERVATION_ID,
    recordOperationalEvent: false,
    appendTrustEvent: async (event) => {
      appended.push(event);
      return { inserted: true, event };
    },
  });

  assert.equal(results.length, 1);
  assert.equal(appended[0].eventType, "user_cancelled_reservation");
  assert.equal(appended[0].eventKey, `reservation:${RESERVATION_ID}:user_cancelled_reservation:${USER_ID}`);
  assert.equal(appended[0].eventPayload.cancellation_delta, 1);
});

test("reservation lifecycle enforcement emits recovery events for successful NGO delivery", async () => {
  const appended = [];
  const client = createReservationClient({
    id: RESERVATION_ID,
    user_id: NGO_ID,
    provider_id: PROVIDER_ID,
    assigned_volunteer_id: VOLUNTEER_ID,
    listing_id: LISTING_ID,
    pickup_type: "ngo",
    status: "picked_up",
    task_status: "delivered",
    completed_at: new Date("2026-01-01T00:00:00.000Z"),
    payment_status: "not_required",
  });

  await recordReservationLifecycleTrustEvents({
    client,
    reservationId: RESERVATION_ID,
    recordOperationalEvent: false,
    appendTrustEvent: async (event) => {
      appended.push(event);
      return { inserted: true, event };
    },
  });

  assert.deepEqual(
    appended.map((event) => event.eventType).sort(),
    [
      "ngo_delivery_completed",
      "provider_successful_fulfillment",
      "volunteer_delivery_completed",
    ]
  );
});

test("verified good behavior is appended as a replay-safe trust event", async () => {
  const appended = [];
  const result = await recordVerifiedGoodBehavior({
    subjectType: "user",
    subjectId: USER_ID,
    sourceType: "moderation",
    sourceId: "case-1",
    appendTrustEvent: async (event) => {
      appended.push(event);
      return { inserted: true, event };
    },
  });

  assert.equal(result.inserted, true);
  assert.equal(appended[0].eventType, "verified_good_behavior");
  assert.equal(appended[0].eventPayload.completion_delta, 1);
  assert.equal(appended[0].eventPayload.metadata.verified_good_behavior, true);
});
