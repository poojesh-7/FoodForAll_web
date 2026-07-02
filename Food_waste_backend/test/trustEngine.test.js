const assert = require("node:assert/strict");
const test = require("node:test");

const {
  appendTrustEvent,
  claimTrustEvents,
} = require("../shared/services/trustEvent.service");
const {
  applyTrustEventProjection,
  buildTrustEffect,
  buildTrustProjectionFromEvents,
  calculateRestrictionLevel,
  getTrustFarmingConfig,
  projectOperationalTrustState,
  RESTRICTION_THRESHOLDS,
  rebuildTrustProjectionForSubject,
} = require("../shared/services/trustProjection.service");
const {
  processTrustEventBatch,
  runTrustEventTransaction,
} = require("../shared/services/trustWorker.service");
const {
  buildListingTrustEvents,
  buildPaymentTrustEvents,
  buildReservationTrustEvents,
  emitBuiltEvents,
  findPaymentInitializationFailureTrustEvents,
  TRUST_EVENT_RULES,
} = require("../shared/services/trustLifecycleEvent.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const NGO_ID = "44444444-4444-4444-8444-444444444444";
const VOLUNTEER_ID = "55555555-5555-4555-8555-555555555555";
const PAYMENT_ID = "66666666-6666-4666-8666-666666666666";
const RESERVATION_ID = "77777777-7777-4777-8777-777777777777";
const SECOND_EVENT_ID = "99999999-9999-4999-8999-999999999999";

function createEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    event_key: "reservation:abc:completed:user",
    subject_type: "user",
    subject_id: USER_ID,
    source_type: "reservation",
    source_id: "abc",
    event_type: "reservation_completed",
    event_payload: {
      score_delta: 5,
      penalty_delta: 0,
      deposit_multiplier_delta: 0,
      ...overrides.event_payload,
    },
    processing_status: "pending",
    attempt_count: 0,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createProjectionEvent(index, eventType, payload, createdAt, overrides = {}) {
  return createEvent({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
    event_key: `trust:test:${index}:${eventType}`,
    event_type: eventType,
    event_payload: payload,
    created_at: new Date(createdAt),
    ...overrides,
  });
}

function createProviderProjectionEvent(index, eventType, payload, createdAt) {
  return createProjectionEvent(index, eventType, payload, createdAt, {
    subject_type: "provider",
    subject_id: PROVIDER_ID,
  });
}

function createProviderReportValidatedEvent(index = 1, createdAt = "2026-01-01T00:00:00.000Z") {
  return createProviderProjectionEvent(
    index,
    "provider_report_validated",
    TRUST_EVENT_RULES.provider_report_validated,
    createdAt
  );
}

function createProviderFulfillmentEvent(index, createdAt, metadata = {}) {
  return createProviderProjectionEvent(index, "provider_successful_fulfillment", {
    ...TRUST_EVENT_RULES.provider_successful_fulfillment,
    metadata,
  }, createdAt);
}

function policyPayload(eventType, overrides = {}) {
  return {
    ...TRUST_EVENT_RULES[eventType],
    ...overrides,
  };
}

function withEnv(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = String(value);
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("appendTrustEvent inserts once and protects duplicate event keys", async () => {
  const insertedRows = [
    {
      id: EVENT_ID,
      event_key: "reservation:abc:completed:user",
    },
    null,
  ];
  const db = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: insertedRows.shift() ? [{ id: EVENT_ID, event_key: params[0] }] : [] };
    },
  };
  const queue = {
    jobs: [],
    async add(name, data, opts) {
      this.jobs.push({ name, data, opts });
    },
  };

  const input = {
    eventKey: "reservation:abc:completed:user",
    subjectType: "user",
    subjectId: USER_ID,
    sourceType: "reservation",
    sourceId: "abc",
    eventType: "reservation_completed",
    eventPayload: { score_delta: 5 },
  };

  const first = await appendTrustEvent(input, {
    db,
    queue,
    recordOperationalEvent: false,
  });
  const duplicate = await appendTrustEvent(input, {
    db,
    queue,
    recordOperationalEvent: false,
  });

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(queue.jobs.length, 1);
  assert.match(db.queries[0].sql, /ON CONFLICT \(event_key\) DO NOTHING/);
});

test("buildTrustEffect normalizes passive projection deltas", () => {
  const effect = buildTrustEffect(
    createEvent({
      event_payload: {
        trust_delta: -15,
        penalty_delta: 1,
        deposit_multiplier_delta: 0.25,
        restriction_level: 2,
        restriction_type: "cooldown",
        active_until: "2026-01-02T00:00:00.000Z",
      },
    })
  );

  assert.equal(effect.scoreDelta, -15);
  assert.equal(effect.penaltyDelta, 1);
  assert.equal(effect.depositMultiplierDelta, 0.25);
  assert.equal(effect.explicitRestrictionLevel, 2);
  assert.equal(effect.restrictionType, "cooldown");
  assert.equal(effect.activeUntil.toISOString(), "2026-01-02T00:00:00.000Z");
});

test("balanced restriction thresholds require repeated normal failures", () => {
  assert.deepEqual(
    RESTRICTION_THRESHOLDS.map((threshold) => ({
      level: threshold.level,
      penaltyLevel: threshold.penaltyLevel,
      scoreAtOrBelow: threshold.scoreAtOrBelow,
      scoreBelow: threshold.scoreBelow,
      failureStreak: threshold.failureStreak,
    })),
    [
      { level: 5, penaltyLevel: 16, scoreAtOrBelow: 45, scoreBelow: undefined, failureStreak: 7 },
      { level: 4, penaltyLevel: 12, scoreAtOrBelow: 58, scoreBelow: undefined, failureStreak: 5 },
      { level: 3, penaltyLevel: 8, scoreAtOrBelow: 72, scoreBelow: undefined, failureStreak: 4 },
      { level: 2, penaltyLevel: 6, scoreAtOrBelow: 80, scoreBelow: undefined, failureStreak: 3 },
      { level: 1, penaltyLevel: 4, scoreAtOrBelow: undefined, scoreBelow: 88, failureStreak: 2 },
    ]
  );
  assert.equal(calculateRestrictionLevel({ score: 93, penaltyLevel: 2, failureStreak: 1 }), 0);
  assert.equal(calculateRestrictionLevel({ score: 86, penaltyLevel: 4, failureStreak: 2 }), 1);
  assert.equal(calculateRestrictionLevel({ score: 80, penaltyLevel: 6, failureStreak: 3 }), 2);
  assert.equal(calculateRestrictionLevel({ score: 72, penaltyLevel: 8, failureStreak: 4 }), 3);
  assert.equal(calculateRestrictionLevel({ score: 58, penaltyLevel: 12, failureStreak: 5 }), 4);
  assert.equal(calculateRestrictionLevel({ score: 45, penaltyLevel: 16, failureStreak: 7 }), 5);
});

test("calibrated policy keeps first payment timeout unrestricted", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(
      1,
      "user_pickup_completed",
      policyPayload("user_pickup_completed"),
      "2026-01-01T00:00:00.000Z"
    ),
    createProjectionEvent(
      2,
      "user_payment_timeout",
      policyPayload("user_payment_timeout"),
      "2026-01-02T00:00:00.000Z"
    ),
  ]);

  assert.equal(projection.trust_score, 98);
  assert.equal(projection.penalty_level, 1);
  assert.equal(projection.projected_restriction_level, 0);
  assert.equal(projection.projected_deposit_multiplier, 1);
  assert.equal(projection.projected_cooldown_until, null);
  assert.equal(projection.projected_actions.refundable_deposit_recommended, false);
  assert.equal(projection.projected_actions.cooldown_recommended, false);
});

test("successful pickup clears operational cooldown once projection drops below cooldown level", () => {
  const events = [
    createProjectionEvent(
      1,
      "user_pickup_failed",
      policyPayload("user_pickup_failed"),
      "2026-01-01T00:00:00.000Z"
    ),
    createProjectionEvent(
      2,
      "user_payment_timeout",
      policyPayload("user_payment_timeout"),
      "2026-01-01T01:00:00.000Z"
    ),
    createProjectionEvent(
      3,
      "user_payment_timeout",
      policyPayload("user_payment_timeout"),
      "2026-01-01T02:00:00.000Z"
    ),
    createProjectionEvent(
      4,
      "user_payment_timeout",
      policyPayload("user_payment_timeout"),
      "2026-01-01T03:00:00.000Z"
    ),
  ];
  const beforeRecovery = buildTrustProjectionFromEvents(events);
  const afterRecovery = buildTrustProjectionFromEvents([
    ...events,
    createProjectionEvent(
      5,
      "user_pickup_completed",
      policyPayload("user_pickup_completed", {
        metadata: { provider_id: PROVIDER_ID, food_amount: 100 },
      }),
      "2026-01-01T04:00:00.000Z"
    ),
  ]);

  assert.equal(beforeRecovery.projected_restriction_level, 3);
  assert.equal(beforeRecovery.projected_deposit_multiplier, 1.5);
  assert.equal(
    beforeRecovery.projected_cooldown_until.toISOString(),
    "2026-01-01T15:00:00.000Z"
  );
  assert.equal(afterRecovery.trust_score, 91);
  assert.equal(afterRecovery.penalty_level, 5);
  assert.equal(afterRecovery.projected_restriction_level, 1);
  assert.equal(afterRecovery.projected_deposit_multiplier, 1);
  assert.equal(afterRecovery.projected_cooldown_until, null);
  assert.equal(afterRecovery.projected_actions.cooldown_recommended, false);
  assert.equal(afterRecovery.projected_actions.refundable_deposit_recommended, false);
  assert.equal(
    afterRecovery.projected_actions.cooldown_recovery_alignment.previous_cooldown_until,
    "2026-01-01T15:00:00.000Z"
  );
  assert.equal(
    afterRecovery.projected_actions.cooldown_recovery_alignment.cooldown_preserved_this_event,
    false
  );
});

test("calibrated policy forgives one failed pickup after successful history", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(
      1,
      "user_pickup_completed",
      policyPayload("user_pickup_completed"),
      "2026-01-01T00:00:00.000Z"
    ),
    createProjectionEvent(
      2,
      "user_pickup_completed",
      policyPayload("user_pickup_completed"),
      "2026-01-02T00:00:00.000Z"
    ),
    createProjectionEvent(
      3,
      "user_pickup_failed",
      policyPayload("user_pickup_failed"),
      "2026-01-03T00:00:00.000Z"
    ),
  ]);

  assert.equal(projection.trust_score, 93);
  assert.equal(projection.penalty_level, 2);
  assert.equal(projection.projected_restriction_level, 0);
  assert.equal(projection.projected_deposit_multiplier, 1);
  assert.equal(projection.projected_cooldown_until, null);
});

test("calibrated policy escalates cooldown after four failed pickups", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "user_pickup_failed", {
      ...TRUST_EVENT_RULES.user_pickup_failed,
    }, "2026-01-01T00:00:00.000Z"),
    createProjectionEvent(2, "user_pickup_failed", {
      ...TRUST_EVENT_RULES.user_pickup_failed,
    }, "2026-01-02T00:00:00.000Z"),
    createProjectionEvent(3, "user_pickup_failed", {
      ...TRUST_EVENT_RULES.user_pickup_failed,
    }, "2026-01-03T00:00:00.000Z"),
    createProjectionEvent(4, "user_pickup_failed", {
      ...TRUST_EVENT_RULES.user_pickup_failed,
    }, "2026-01-04T00:00:00.000Z"),
  ]);

  assert.equal(projection.trust_score, 72);
  assert.equal(projection.penalty_level, 8);
  assert.equal(projection.projected_restriction_level, 3);
  assert.equal(projection.projected_deposit_multiplier, 1.5);
  assert.equal(projection.projected_actions.cooldown_recommended, true);
  assert.equal(projection.risk_state.restriction_trigger_source, "penalty");
  assert.equal(
    projection.projected_cooldown_until.toISOString(),
    "2026-01-04T12:00:00.000Z"
  );
});

test("volunteer delivery failures escalate faster than normal user failures", () => {
  const volunteerProjection = buildTrustProjectionFromEvents([
    createProjectionEvent(
      1,
      "volunteer_delivery_failed",
      policyPayload("volunteer_delivery_failed"),
      "2026-01-01T00:00:00.000Z",
      {
        subject_type: "volunteer",
        subject_id: VOLUNTEER_ID,
      }
    ),
    createProjectionEvent(
      2,
      "volunteer_delivery_failed",
      policyPayload("volunteer_delivery_failed"),
      "2026-01-02T00:00:00.000Z",
      {
        subject_type: "volunteer",
        subject_id: VOLUNTEER_ID,
      }
    ),
    createProjectionEvent(
      3,
      "volunteer_delivery_failed",
      policyPayload("volunteer_delivery_failed"),
      "2026-01-03T00:00:00.000Z",
      {
        subject_type: "volunteer",
        subject_id: VOLUNTEER_ID,
      }
    ),
  ], "volunteer", VOLUNTEER_ID);
  const userProjection = buildTrustProjectionFromEvents([
    createProjectionEvent(
      1,
      "user_pickup_failed",
      policyPayload("user_pickup_failed"),
      "2026-01-01T00:00:00.000Z"
    ),
    createProjectionEvent(
      2,
      "user_pickup_failed",
      policyPayload("user_pickup_failed"),
      "2026-01-02T00:00:00.000Z"
    ),
    createProjectionEvent(
      3,
      "user_pickup_failed",
      policyPayload("user_pickup_failed"),
      "2026-01-03T00:00:00.000Z"
    ),
  ]);

  assert.equal(volunteerProjection.projected_restriction_level, 3);
  assert.equal(volunteerProjection.projected_deposit_multiplier, 1.5);
  assert.ok(volunteerProjection.projected_cooldown_until);
  assert.equal(userProjection.projected_restriction_level, 2);
  assert.equal(userProjection.projected_cooldown_until, null);
});

test("validated provider reports remain significant and repeated reports trigger cooldown", () => {
  const firstReport = buildTrustProjectionFromEvents([
    createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
  ], "provider", PROVIDER_ID);
  const repeatedReports = buildTrustProjectionFromEvents([
    createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
    createProviderReportValidatedEvent(2, "2026-01-02T00:00:00.000Z"),
  ], "provider", PROVIDER_ID);

  assert.equal(firstReport.trust_score, 85);
  assert.equal(firstReport.projected_restriction_level, 1);
  assert.equal(firstReport.projected_deposit_multiplier, 1);
  assert.equal(firstReport.projected_cooldown_until, null);
  assert.equal(repeatedReports.trust_score, 70);
  assert.equal(repeatedReports.projected_restriction_level, 3);
  assert.equal(repeatedReports.projected_deposit_multiplier, 1.5);
  assert.equal(
    repeatedReports.projected_cooldown_until.toISOString(),
    "2026-01-02T02:00:00.000Z"
  );
});

test("recovery events do not refresh active cooldowns while restriction remains high", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(2, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T01:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(3, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T02:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(4, "ngo_delivery_completed", {
      score_delta: 3,
      completion_delta: 1,
      metadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
    }, "2026-01-01T13:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
  ], "ngo", NGO_ID);

  assert.equal(projection.projected_restriction_level, 3);
  assert.equal(projection.recovery_progress, 50);
  assert.equal(
    projection.projected_cooldown_until.toISOString(),
    "2026-01-01T14:00:00.000Z"
  );
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.cooldown_trigger_event,
    "ngo_delivery_failed"
  );
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.cooldown_source_reason,
    "negative_event"
  );
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.cooldown_created_at,
    "2026-01-01T02:00:00.000Z"
  );
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.cooldown_refreshed_this_event,
    false
  );
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.cooldown_refresh_allowed,
    false
  );
});

test("recovery clears unexpired cooldown when restriction drops below cooldown level", () => {
  const events = [
    createProjectionEvent(1, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(2, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T01:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(3, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T02:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
  ];

  for (let index = 4; index <= 5; index += 1) {
    events.push(
      createProjectionEvent(index, "ngo_delivery_completed", {
        score_delta: 3,
        completion_delta: 1,
        metadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
      }, `2026-01-01T0${index - 1}:00:00.000Z`, {
        subject_type: "ngo",
        subject_id: NGO_ID,
      })
    );
  }

  const projection = buildTrustProjectionFromEvents(events, "ngo", NGO_ID);

  assert.equal(projection.penalty_level, 4);
  assert.equal(projection.projected_restriction_level, 2);
  assert.equal(projection.projected_deposit_multiplier, 1.25);
  assert.equal(projection.projected_cooldown_until, null);
  assert.equal(projection.projected_actions.cooldown_recommended, false);
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.cooldown_preserved_this_event,
    false
  );
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.previous_cooldown_until,
    "2026-01-01T14:00:00.000Z"
  );
});

test("expired cooldowns are not recreated by recovery events", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(2, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T01:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(3, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T02:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(4, "ngo_delivery_completed", {
      score_delta: 3,
      completion_delta: 1,
      metadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
    }, "2026-01-02T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
  ], "ngo", NGO_ID);

  assert.equal(projection.projected_restriction_level, 3);
  assert.equal(projection.projected_cooldown_until, null);
  assert.equal(projection.projected_actions.cooldown_recommended, false);
  assert.equal(
    projection.projected_actions.cooldown_recovery_alignment.cooldown_expired_at_event_time,
    true
  );
  assert.equal(
    projection.recovery_state.blocked_actor_recovery_status.blocked,
    false
  );
});

test("critical projections expose blocked actor recovery route", () => {
  const events = [];
  for (let index = 1; index <= 6; index += 1) {
    events.push(
      createProjectionEvent(index, "user_pickup_failed", {
        score_delta: -10,
        failure_delta: 1,
      }, `2026-01-0${index}T00:00:00.000Z`)
    );
  }

  const projection = buildTrustProjectionFromEvents(events);

  assert.equal(projection.trust_score, 40);
  assert.equal(projection.penalty_level, 12);
  assert.equal(projection.projected_restriction_level, 5);
  assert.ok(projection.risk_state.restriction_trigger_sources.includes("score"));
  assert.equal(
    projection.recovery_state.blocked_actor_recovery_status.deterministic_recovery_route,
    "verified_good_behavior"
  );
  assert.equal(
    projection.recovery_state.recovery_requirements.score_points_to_clear_current_score_trigger,
    6
  );
  assert.equal(
    projection.recovery_state.recovery_requirements.successes_to_clear_penalty,
    12
  );
});

test("operational projection recommends deposit escalation at level 2", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createProjectionEvent(2, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T01:00:00.000Z"),
  ]);

  assert.equal(projection.projected_restriction_level, 2);
  assert.equal(projection.projected_deposit_multiplier, 1.25);
  assert.equal(projection.projected_actions.refundable_deposit_recommended, true);
  assert.equal(projection.projected_actions.enforcement_active, true);
});

test("expired unsold listings emit analytics-only provider trust events", () => {
  const events = buildListingTrustEvents({
    id: "88888888-8888-4888-8888-888888888888",
    provider_id: PROVIDER_ID,
    status: "expired",
    pickup_end_time: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "provider_listing_expired");
  assert.equal(events[0].subjectType, "provider");
  assert.equal(events[0].eventPayload.analytics_only, true);
  assert.equal(events[0].eventPayload.trust_impact, "neutral");
  assert.equal(events[0].eventPayload.score_delta, undefined);
  assert.equal(events[0].eventPayload.timeout_delta, undefined);

  const effect = buildTrustEffect({
    id: EVENT_ID,
    event_type: events[0].eventType,
    subject_type: events[0].subjectType,
    subject_id: events[0].subjectId,
    event_payload: events[0].eventPayload,
  });

  assert.equal(effect.analyticsOnly, true);
  assert.equal(effect.scoreDelta, 0);
  assert.equal(effect.timeoutDelta, 0);
  assert.equal(effect.penaltyDelta, 0);
});

test("provider listing expiry replay is neutral even for legacy negative payloads", () => {
  const projection = buildTrustProjectionFromEvents([
    createProviderProjectionEvent(1, "provider_listing_expired", {
      score_delta: -3,
      timeout_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createProviderProjectionEvent(2, "provider_listing_expired", {
      score_delta: -3,
      timeout_delta: 1,
    }, "2026-01-02T00:00:00.000Z"),
  ], "provider", PROVIDER_ID);

  assert.equal(projection.trust_score, 100);
  assert.equal(projection.penalty_level, 0);
  assert.equal(projection.timeout_count, 0);
  assert.equal(projection.failure_streak, 0);
  assert.equal(projection.projected_restriction_level, 0);
  assert.equal(projection.projected_deposit_multiplier, 1);
  assert.equal(projection.projected_cooldown_until, null);
  assert.equal(projection.projected_actions.cooldown_recommended, false);
});

test("provider trust remains stable across normal listing expiry lifecycle", () => {
  const projection = buildTrustProjectionFromEvents([
    createProviderProjectionEvent(1, "provider_listing_expired", {
      analytics_only: true,
      trust_impact: "neutral",
    }, "2026-01-01T00:00:00.000Z"),
    createProviderProjectionEvent(2, "provider_listing_expired", {
      analytics_only: true,
      trust_impact: "neutral",
    }, "2026-01-03T00:00:00.000Z"),
    createProviderProjectionEvent(3, "provider_successful_fulfillment", {
      ...TRUST_EVENT_RULES.provider_successful_fulfillment,
    }, "2026-01-04T00:00:00.000Z"),
  ], "provider", PROVIDER_ID);

  assert.equal(projection.trust_score, 100);
  assert.equal(projection.penalty_level, 0);
  assert.equal(projection.timeout_count, 0);
  assert.equal(projection.fulfillment_count, 1);
  assert.equal(projection.projected_restriction_level, 0);
  assert.equal(projection.projected_deposit_multiplier, 1);
});

test("only actionable provider failures affect provider projections", () => {
  const projection = buildTrustProjectionFromEvents([
    createProviderProjectionEvent(1, "provider_listing_expired", {
      score_delta: -3,
      timeout_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createProviderProjectionEvent(2, "provider_report_validated", {
      score_delta: -15,
      failure_delta: 1,
    }, "2026-01-02T00:00:00.000Z"),
  ], "provider", PROVIDER_ID);

  assert.equal(projection.trust_score, 85);
  assert.equal(projection.penalty_level, 2);
  assert.equal(projection.timeout_count, 0);
  assert.equal(projection.failure_count, 1);
  assert.equal(projection.projected_restriction_level, 1);
  assert.equal(projection.projected_deposit_multiplier, 1);
  assert.equal(projection.projected_actions.cooldown_recommended, false);
});

test("provider successful fulfillments clear report penalties through domain recovery", () => {
  withEnv({ TRUST_MAX_GAIN_PER_DAY: 20 }, () => {
    const projection = buildTrustProjectionFromEvents([
      createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
      createProviderFulfillmentEvent(2, "2026-01-02T00:00:00.000Z", {
        food_amount: 100,
      }),
      createProviderFulfillmentEvent(3, "2026-01-03T00:00:00.000Z", {
        food_amount: 100,
      }),
      createProviderFulfillmentEvent(4, "2026-01-04T00:00:00.000Z", {
        food_amount: 100,
      }),
    ], "provider", PROVIDER_ID);

    assert.equal(projection.trust_score, 98);
    assert.equal(projection.penalty_level, 0);
    assert.equal(projection.projected_restriction_level, 0);
    assert.equal(projection.restriction_level, 0);
    assert.equal(projection.fulfillment_count, 3);
    assert.equal(projection.failure_streak, 0);
    assert.equal(projection.success_streak, 1);
    assert.equal(projection.recovery_progress, 100);
    assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
    assert.equal(projection.last_success_at.toISOString(), "2026-01-04T00:00:00.000Z");
  });
});

test("provider fulfillment recovery is independent of score suppression and daily caps", () => {
  const suppressedBySource = buildTrustProjectionFromEvents([
    createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
    createProviderFulfillmentEvent(2, "2026-01-02T00:00:00.000Z", {
      is_free: true,
      food_amount: 0,
    }),
    createProviderFulfillmentEvent(3, "2026-01-03T00:00:00.000Z", {
      is_free: true,
      food_amount: 0,
    }),
    createProviderFulfillmentEvent(4, "2026-01-04T00:00:00.000Z", {
      is_free: true,
      food_amount: 0,
    }),
  ], "provider", PROVIDER_ID);

  assert.equal(suppressedBySource.trust_score, 89);
  assert.equal(suppressedBySource.penalty_level, 0);
  assert.equal(suppressedBySource.projected_restriction_level, 0);
  assert.equal(suppressedBySource.fulfillment_count, 3);
  assert.equal(suppressedBySource.success_streak, 1);
  assert.equal(suppressedBySource.recovery_state.recovery_credit_this_event, 0);
  assert.equal(
    suppressedBySource.score_breakdown.trust_quality.suppression_reason,
    "non_qualifying_source"
  );
  assert.equal(suppressedBySource.score_breakdown.trust_quality.applied_score_delta, 0);

  withEnv({ TRUST_MAX_GAIN_PER_DAY: 0 }, () => {
    const suppressedByDailyCap = buildTrustProjectionFromEvents([
      createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
      createProviderFulfillmentEvent(2, "2026-01-02T00:00:00.000Z", {
        food_amount: 100,
      }),
      createProviderFulfillmentEvent(3, "2026-01-03T00:00:00.000Z", {
        food_amount: 100,
      }),
      createProviderFulfillmentEvent(4, "2026-01-04T00:00:00.000Z", {
        food_amount: 100,
      }),
    ], "provider", PROVIDER_ID);

    assert.equal(suppressedByDailyCap.trust_score, 89);
    assert.equal(suppressedByDailyCap.penalty_level, 0);
    assert.equal(suppressedByDailyCap.projected_restriction_level, 0);
    assert.equal(suppressedByDailyCap.recovery_state.recovery_credit_this_event, 0);
    assert.equal(suppressedByDailyCap.score_breakdown.trust_quality.applied_score_delta, 0);
    assert.equal(suppressedByDailyCap.score_breakdown.trust_quality.daily_cap_applied, true);
  });
});

test("internal provider fulfillments remain blocked from recovery", () => {
  const projection = buildTrustProjectionFromEvents([
    createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
    createProviderFulfillmentEvent(2, "2026-01-02T00:00:00.000Z", {
      food_amount: 100,
      internal: true,
    }),
    createProviderFulfillmentEvent(3, "2026-01-03T00:00:00.000Z", {
      food_amount: 100,
      system_generated: true,
    }),
    createProviderFulfillmentEvent(4, "2026-01-04T00:00:00.000Z", {
      food_amount: 100,
      systemGenerated: true,
    }),
  ], "provider", PROVIDER_ID);

  assert.equal(projection.trust_score, 85);
  assert.equal(projection.penalty_level, 2);
  assert.equal(projection.projected_restriction_level, 1);
  assert.equal(projection.fulfillment_count, 3);
  assert.equal(projection.failure_streak, 0);
  assert.equal(projection.success_streak, 0);
  assert.equal(projection.recovery_progress, 0);
  assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
  assert.equal(projection.last_success_at, null);
  assert.equal(
    projection.score_breakdown.trust_quality.suppression_reason,
    "non_qualifying_source"
  );
});

test("provider fulfillment recovery replay is deterministic across event order", () => {
  const events = [
    createProviderFulfillmentEvent(4, "2026-01-04T00:00:00.000Z", {
      food_amount: 100,
    }),
    createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
    createProviderFulfillmentEvent(3, "2026-01-03T00:00:00.000Z", {
      food_amount: 100,
    }),
    createProviderFulfillmentEvent(2, "2026-01-02T00:00:00.000Z", {
      food_amount: 100,
    }),
  ];
  const ordered = buildTrustProjectionFromEvents(events, "provider", PROVIDER_ID);
  const replayed = buildTrustProjectionFromEvents([...events].reverse(), "provider", PROVIDER_ID);

  assert.deepEqual(
    {
      trust_score: replayed.trust_score,
      penalty_level: replayed.penalty_level,
      projected_restriction_level: replayed.projected_restriction_level,
      fulfillment_count: replayed.fulfillment_count,
      success_streak: replayed.success_streak,
      recovery_progress: replayed.recovery_progress,
    },
    {
      trust_score: ordered.trust_score,
      penalty_level: ordered.penalty_level,
      projected_restriction_level: ordered.projected_restriction_level,
      fulfillment_count: ordered.fulfillment_count,
      success_streak: ordered.success_streak,
      recovery_progress: ordered.recovery_progress,
    }
  );
});

test("consecutive successful completions reduce passive penalties", () => {
  const events = [
    createProjectionEvent(1, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
  ];

  for (let index = 2; index <= 4; index += 1) {
    events.push(
      createProjectionEvent(index, "user_pickup_completed", {
        score_delta: 3,
        completion_delta: 1,
      }, `2026-01-0${index}T00:00:00.000Z`)
    );
  }

  const projection = buildTrustProjectionFromEvents(events);

  assert.equal(projection.penalty_level, 0);
  assert.equal(projection.projected_restriction_level, 0);
  assert.equal(projection.recovery_progress, 100);
  assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
  assert.equal(projection.recovery_state.recovery_requirements.successes_to_clear_penalty, 0);
});

test("verified good behavior participates in deterministic recovery", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createProjectionEvent(
      2,
      "verified_good_behavior",
      policyPayload("verified_good_behavior"),
      "2026-01-02T00:00:00.000Z"
    ),
    createProjectionEvent(
      3,
      "verified_good_behavior",
      policyPayload("verified_good_behavior"),
      "2026-01-03T00:00:00.000Z"
    ),
    createProjectionEvent(
      4,
      "verified_good_behavior",
      policyPayload("verified_good_behavior"),
      "2026-01-04T00:00:00.000Z"
    ),
  ]);

  assert.equal(projection.penalty_level, 0);
  assert.equal(projection.projected_restriction_level, 0);
  assert.equal(projection.projected_deposit_multiplier, 1);
  assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
});

test("stable successful behavior applies passive decay by event time", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createProjectionEvent(2, "user_pickup_completed", {
      score_delta: 3,
      completion_delta: 1,
    }, "2026-01-20T00:00:00.000Z"),
  ]);

  assert.equal(projection.penalty_level, 1);
  assert.equal(projection.decay_state.decay_credit_this_event, 1);
  assert.equal(projection.decay_state.score_recovered_this_event, 2);
  assert.equal(projection.trust_score, 95);
});

test("same-provider repeated pickup gains decay by configured diversity policy", () => {
  withEnv({ TRUST_PROVIDER_REPEAT_DECAY: "1,0.5,0", TRUST_MAX_GAIN_PER_DAY: 20 }, () => {
    const projection = buildTrustProjectionFromEvents([
      createProjectionEvent(1, "user_pickup_failed", {
        score_delta: -10,
        failure_delta: 1,
      }, "2026-01-01T00:00:00.000Z"),
      createProjectionEvent(2, "user_pickup_completed", {
        score_delta: 3,
        completion_delta: 1,
        metadata: { provider_id: PROVIDER_ID, food_amount: 100 },
      }, "2026-01-02T00:00:00.000Z"),
      createProjectionEvent(3, "user_pickup_completed", {
        score_delta: 3,
        completion_delta: 1,
        metadata: { provider_id: PROVIDER_ID, food_amount: 100 },
      }, "2026-01-02T01:00:00.000Z"),
      createProjectionEvent(4, "user_pickup_completed", {
        score_delta: 3,
        completion_delta: 1,
        metadata: { provider_id: PROVIDER_ID, food_amount: 100 },
      }, "2026-01-02T02:00:00.000Z"),
    ]);

    assert.equal(projection.score_breakdown.trust_quality.provider_repeat_count, 3);
    assert.equal(projection.score_breakdown.trust_quality.provider_decay_factor, 0);
    assert.equal(projection.score_breakdown.trust_quality.applied_score_delta, 0);
    assert.equal(projection.trust_score, 98.5);
    assert.equal(projection.penalty_level, 0);
    assert.equal(projection.success_streak, 1);
    assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
  });
});

test("daily trust gain cap limits positive score growth", () => {
  withEnv({ TRUST_MAX_GAIN_PER_DAY: 4, TRUST_PROVIDER_REPEAT_DECAY: "1,1,1" }, () => {
    const projection = buildTrustProjectionFromEvents([
      createProjectionEvent(1, "user_pickup_failed", {
        score_delta: -20,
        failure_delta: 1,
      }, "2026-01-01T00:00:00.000Z"),
      createProjectionEvent(2, "user_pickup_completed", {
        score_delta: 3,
        completion_delta: 1,
        metadata: { provider_id: PROVIDER_ID, food_amount: 100 },
      }, "2026-01-02T00:00:00.000Z"),
      createProjectionEvent(3, "user_pickup_completed", {
        score_delta: 3,
        completion_delta: 1,
        metadata: { provider_id: "88888888-8888-4888-8888-888888888888", food_amount: 100 },
      }, "2026-01-02T01:00:00.000Z"),
    ]);

    assert.equal(projection.trust_score, 88);
    assert.equal(projection.score_breakdown.trust_quality.daily_cap_applied, true);
    assert.equal(projection.score_breakdown.trust_quality.applied_score_delta, 1);
  });
});

test("free and zero-value reservations do not award positive trust gain", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createProjectionEvent(2, "user_pickup_completed", {
      score_delta: 3,
      completion_delta: 1,
      metadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
    }, "2026-01-02T00:00:00.000Z"),
  ]);

  assert.equal(projection.trust_score, 90);
  assert.equal(projection.penalty_level, 2);
  assert.equal(projection.success_streak, 1);
  assert.equal(projection.recovery_progress, 50);
  assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
  assert.equal(projection.last_success_at.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.equal(
    projection.score_breakdown.trust_quality.suppression_reason,
    "non_qualifying_source"
  );
  assert.equal(projection.score_breakdown.trust_quality.applied_score_delta, 0);
});

test("T5.3.1 user pickups recover penalties independently of score gain suppression", () => {
  withEnv({ TRUST_PROVIDER_REPEAT_DECAY: "1,0.5,0", TRUST_MAX_GAIN_PER_DAY: 10 }, () => {
    const startingState = {
      subject_type: "user",
      subject_id: USER_ID,
      trust_score: 82,
      penalty_level: 5,
      projected_restriction_level: 2,
      restriction_level: 2,
      projected_deposit_multiplier: 1.5,
      deposit_multiplier: 1.5,
      recovery_progress: 0,
      success_streak: 0,
      failure_streak: 0,
    };

    function projectPickups(count, metadataForIndex) {
      let projection = { ...startingState };
      const context = {
        config: getTrustFarmingConfig(),
        dailyPositiveGain: new Map(),
        providerRepeatCounts: new Map(),
      };

      for (let index = 1; index <= count; index += 1) {
        const event = createProjectionEvent(index, "user_pickup_completed", {
          score_delta: 3,
          completion_delta: 1,
          metadata: metadataForIndex(index),
        }, `2026-01-01T${String(index).padStart(2, "0")}:00:00.000Z`, {
          subject_type: "user",
          subject_id: USER_ID,
        });
        projection = projectOperationalTrustState(
          projection,
          event,
          buildTrustEffect(event),
          context
        );
      }

      return projection;
    }

    const sameProvider = (index) => projectPickups(index, () => ({
      provider_id: PROVIDER_ID,
      food_amount: 100,
    }));
    const differentProviders = (index) => projectPickups(index, (eventIndex) => ({
      provider_id: `provider-${eventIndex}`,
      food_amount: 100,
    }));
    const zeroValue = (index) => projectPickups(index, (eventIndex) => ({
      provider_id: `provider-${eventIndex}`,
      food_amount: 0,
    }));

    const sameProviderAfter3 = sameProvider(3);
    assert.equal(sameProviderAfter3.trust_score, 90.5);
    assert.equal(sameProviderAfter3.penalty_level, 3);
    assert.equal(sameProviderAfter3.projected_restriction_level, 0);
    assert.equal(sameProviderAfter3.score_breakdown.trust_quality.applied_score_delta, 0);
    assert.equal(sameProviderAfter3.score_breakdown.trust_quality.provider_decay_factor, 0);

    const sameProviderAfter6 = sameProvider(6);
    assert.equal(sameProviderAfter6.trust_score, 96.5);
    assert.equal(sameProviderAfter6.penalty_level, 0);
    assert.equal(sameProviderAfter6.projected_restriction_level, 0);

    const sameProviderAfter9 = sameProvider(9);
    assert.equal(sameProviderAfter9.trust_score, 96.5);
    assert.equal(sameProviderAfter9.penalty_level, 0);
    assert.equal(sameProviderAfter9.projected_restriction_level, 0);

    const differentProvidersAfter3 = differentProviders(3);
    assert.equal(differentProvidersAfter3.trust_score, 95);
    assert.equal(differentProvidersAfter3.penalty_level, 3);
    assert.equal(differentProvidersAfter3.projected_restriction_level, 0);

    const differentProvidersAfter6 = differentProviders(6);
    assert.equal(differentProvidersAfter6.trust_score, 100);
    assert.equal(differentProvidersAfter6.penalty_level, 0);
    assert.equal(differentProvidersAfter6.projected_restriction_level, 0);

    const differentProvidersAfter9 = differentProviders(9);
    assert.equal(differentProvidersAfter9.trust_score, 100);
    assert.equal(differentProvidersAfter9.penalty_level, 0);
    assert.equal(differentProvidersAfter9.projected_restriction_level, 0);
    assert.equal(differentProvidersAfter9.score_breakdown.trust_quality.daily_cap_applied, true);
    assert.equal(differentProvidersAfter9.score_breakdown.trust_quality.applied_score_delta, 0);

    const zeroValueAfter3 = zeroValue(3);
    assert.equal(zeroValueAfter3.trust_score, 86);
    assert.equal(zeroValueAfter3.penalty_level, 3);
    assert.equal(zeroValueAfter3.projected_restriction_level, 1);

    const zeroValueAfter6 = zeroValue(6);
    assert.equal(zeroValueAfter6.trust_score, 92);
    assert.equal(zeroValueAfter6.penalty_level, 0);
    assert.equal(zeroValueAfter6.projected_restriction_level, 0);

    const zeroValueAfter9 = zeroValue(9);
    assert.equal(zeroValueAfter9.trust_score, 92);
    assert.equal(zeroValueAfter9.penalty_level, 0);
    assert.equal(zeroValueAfter9.projected_restriction_level, 0);
    assert.equal(
      zeroValueAfter9.score_breakdown.trust_quality.suppression_reason,
      "zero_value_reservation"
    );
    assert.equal(zeroValueAfter9.score_breakdown.trust_quality.applied_score_delta, 0);
  });
});

test("free NGO rescue completions qualify for recovery without score gain", () => {
  const events = [
    createProjectionEvent(1, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(2, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-02T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
  ];

  for (let index = 3; index <= 5; index += 1) {
    events.push(
      createProjectionEvent(index, "ngo_delivery_completed", {
        score_delta: 3,
        completion_delta: 1,
        metadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
      }, `2026-01-0${index}T00:00:00.000Z`, {
        subject_type: "ngo",
        subject_id: NGO_ID,
      })
    );
  }

  const projection = buildTrustProjectionFromEvents(events, "ngo", NGO_ID);

  assert.equal(projection.completion_count, 3);
  assert.equal(projection.trust_score, 84);
  assert.equal(projection.penalty_level, 2);
  assert.equal(projection.projected_restriction_level, 1);
  assert.equal(projection.success_streak, 1);
  assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
  assert.equal(projection.last_success_at.toISOString(), "2026-01-05T00:00:00.000Z");
  assert.equal(
    projection.score_breakdown.trust_quality.suppression_reason,
    "non_qualifying_source"
  );
  assert.equal(projection.score_breakdown.trust_quality.applied_score_delta, 0);
});

test("free volunteer rescue completions qualify for recovery without score gain", () => {
  const events = [
    createProjectionEvent(1, "volunteer_delivery_failed", {
      score_delta: -12,
      failure_delta: 1,
      timeout_delta: 1,
    }, "2026-01-01T00:00:00.000Z", {
      subject_type: "volunteer",
      subject_id: VOLUNTEER_ID,
    }),
    createProjectionEvent(2, "volunteer_delivery_failed", {
      score_delta: -12,
      failure_delta: 1,
      timeout_delta: 1,
    }, "2026-01-02T00:00:00.000Z", {
      subject_type: "volunteer",
      subject_id: VOLUNTEER_ID,
    }),
  ];

  for (let index = 3; index <= 5; index += 1) {
    events.push(
      createProjectionEvent(index, "volunteer_delivery_completed", {
        score_delta: 4,
        completion_delta: 1,
        metadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
      }, `2026-01-0${index}T00:00:00.000Z`, {
        subject_type: "volunteer",
        subject_id: VOLUNTEER_ID,
      })
    );
  }

  const projection = buildTrustProjectionFromEvents(events, "volunteer", VOLUNTEER_ID);

  assert.equal(projection.completion_count, 3);
  assert.equal(projection.trust_score, 80);
  assert.equal(projection.penalty_level, 4);
  assert.equal(projection.projected_restriction_level, 2);
  assert.equal(projection.projected_deposit_multiplier, 1.25);
  assert.equal(projection.success_streak, 1);
  assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
  assert.equal(projection.last_success_at.toISOString(), "2026-01-05T00:00:00.000Z");
  assert.equal(
    projection.score_breakdown.trust_quality.suppression_reason,
    "non_qualifying_source"
  );
  assert.equal(projection.score_breakdown.trust_quality.applied_score_delta, 0);
});

test("T5.3 recovery simulations keep cooldown aligned by role", () => {
  const scenarios = [
    {
      subjectType: "ngo",
      subjectId: NGO_ID,
      failureEvent: "ngo_delivery_failed",
      failurePayload: { score_delta: -10, failure_delta: 1 },
      successEvent: "ngo_delivery_completed",
      successPayload: { score_delta: 3, completion_delta: 1 },
      successMetadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
      checkpoints: {
        3: { score: 84, penalty: 2, level: 1, cooldown: null, deposit: 1 },
        6: { score: 88, penalty: 0, level: 0, cooldown: null, deposit: 1 },
        9: { score: 88, penalty: 0, level: 0, cooldown: null, deposit: 1 },
      },
    },
    {
      subjectType: "volunteer",
      subjectId: VOLUNTEER_ID,
      failureEvent: "volunteer_delivery_failed",
      failurePayload: { score_delta: -12, failure_delta: 1, timeout_delta: 1 },
      successEvent: "volunteer_delivery_completed",
      successPayload: { score_delta: 4, completion_delta: 1 },
      successMetadata: { provider_id: PROVIDER_ID, is_free: true, food_amount: 0 },
      checkpoints: {
        3: { score: 80, penalty: 4, level: 2, cooldown: null, deposit: 1.25 },
      },
    },
    {
      subjectType: "user",
      subjectId: USER_ID,
      failureEvent: "user_pickup_failed",
      failurePayload: { score_delta: -10, failure_delta: 1 },
      successEvent: "user_pickup_completed",
      successPayload: { score_delta: 3, completion_delta: 1 },
      successMetadata: { provider_id: PROVIDER_ID, food_amount: 100 },
      checkpoints: {
        3: { score: 93, penalty: 2, level: 0, cooldown: null, deposit: 1 },
      },
    },
  ];

  for (const scenario of scenarios) {
    const baseEvents = [
      createProjectionEvent(1, scenario.failureEvent, scenario.failurePayload, "2026-01-01T00:00:00.000Z", {
        subject_type: scenario.subjectType,
        subject_id: scenario.subjectId,
      }),
      createProjectionEvent(2, scenario.failureEvent, scenario.failurePayload, "2026-01-02T00:00:00.000Z", {
        subject_type: scenario.subjectType,
        subject_id: scenario.subjectId,
      }),
    ];

    for (const [successCount, expected] of Object.entries(scenario.checkpoints)) {
      const events = [...baseEvents];
      for (let index = 1; index <= Number(successCount); index += 1) {
        events.push(
          createProjectionEvent(index + 2, scenario.successEvent, {
            ...scenario.successPayload,
            metadata: {
              ...scenario.successMetadata,
              provider_id: `${scenario.successMetadata.provider_id}:${index}`,
            },
          }, `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`, {
            subject_type: scenario.subjectType,
            subject_id: scenario.subjectId,
          })
        );
      }

      const projection = buildTrustProjectionFromEvents(
        events,
        scenario.subjectType,
        scenario.subjectId
      );

      assert.equal(projection.trust_score, expected.score);
      assert.equal(projection.penalty_level, expected.penalty);
      assert.equal(projection.projected_restriction_level, expected.level);
      assert.equal(projection.projected_cooldown_until, expected.cooldown);
      assert.equal(projection.projected_deposit_multiplier, expected.deposit);
    }
  }
});

test("internal NGO completions remain blocked from recovery", () => {
  const projection = buildTrustProjectionFromEvents([
    createProjectionEvent(1, "ngo_delivery_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
    createProjectionEvent(2, "ngo_delivery_completed", {
      score_delta: 3,
      completion_delta: 1,
      metadata: {
        provider_id: PROVIDER_ID,
        is_free: true,
        food_amount: 0,
        internal: true,
      },
    }, "2026-01-02T00:00:00.000Z", {
      subject_type: "ngo",
      subject_id: NGO_ID,
    }),
  ], "ngo", NGO_ID);

  assert.equal(projection.completion_count, 1);
  assert.equal(projection.trust_score, 90);
  assert.equal(projection.penalty_level, 2);
  assert.equal(projection.success_streak, 0);
  assert.equal(projection.last_success_at, null);
  assert.equal(projection.recovery_state.recovery_credit_this_event, 0);
});

test("projection replay is deterministic regardless of input order", () => {
  const events = [
    createProjectionEvent(1, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createProjectionEvent(2, "user_cancelled_reservation", {
      score_delta: -2,
      cancellation_delta: 1,
    }, "2026-01-02T00:00:00.000Z"),
    createProjectionEvent(3, "user_pickup_completed", {
      score_delta: 3,
      completion_delta: 1,
    }, "2026-01-03T00:00:00.000Z"),
  ];

  const replay = buildTrustProjectionFromEvents(events);
  const shuffledReplay = buildTrustProjectionFromEvents([...events].reverse());

  assert.deepEqual(
    {
      score: shuffledReplay.trust_score,
      penalty: shuffledReplay.penalty_level,
      level: shuffledReplay.projected_restriction_level,
      counters: shuffledReplay.score_breakdown.counters,
      actions: shuffledReplay.projected_actions,
    },
    {
      score: replay.trust_score,
      penalty: replay.penalty_level,
      level: replay.projected_restriction_level,
      counters: replay.score_breakdown.counters,
      actions: replay.projected_actions,
    }
  );
});

test("applyTrustEventProjection applies score once per effect hash", async () => {
  const calls = [];
  const event = createEvent();
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO trust_event_effects")) {
        return { rows: [{ event_id: params[0] }] };
      }
      if (sql.includes("FROM trust_events te")) {
        return { rows: [event] };
      }
      if (sql.includes("INSERT INTO trust_scores")) {
        return {
          rows: [
            {
              subject_type: params[0],
              subject_id: params[1],
              trust_score: params[2],
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO trust_restrictions")) {
        return { rows: [{ restriction_type: "operational_projection" }] };
      }
      return { rows: [] };
    },
  };

  const result = await applyTrustEventProjection(client, event);

  assert.equal(result.applied, true);
  assert.equal(result.score.trust_score, 100);
  assert.ok(calls.some((call) => String(call.sql).includes("pg_advisory_xact_lock")));
  assert.ok(calls.some((call) => String(call.sql).includes("FROM trust_events te")));
  assert.ok(calls.some((call) => String(call.sql).includes("INSERT INTO trust_restrictions")));
});

test("provider projection rebuild replays trust_events with neutral listing expiry", async () => {
  const calls = [];
  const legacyExpiry = createProviderProjectionEvent(1, "provider_listing_expired", {
    score_delta: -3,
    timeout_delta: 1,
  }, "2026-01-01T00:00:00.000Z");
  const actionableFailure = createProviderProjectionEvent(2, "provider_report_validated", {
    score_delta: -15,
    failure_delta: 1,
  }, "2026-01-02T00:00:00.000Z");
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      if (sql.includes("FROM trust_events") && !sql.includes("JOIN trust_event_effects")) {
        return { rows: [legacyExpiry, actionableFailure] };
      }
      if (sql.includes("INSERT INTO trust_scores")) {
        return {
          rows: [
            {
              subject_type: params[0],
              subject_id: params[1],
              trust_score: params[2],
              penalty_level: params[3],
              timeout_count: params[10],
              projected_restriction_level: params[13],
              projected_deposit_multiplier: params[15],
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO trust_restrictions")) {
        return { rows: [{ restriction_type: "operational_projection" }] };
      }
      return { rows: [] };
    },
  };

  const result = await rebuildTrustProjectionForSubject(client, {
    subjectType: "provider",
    subjectId: PROVIDER_ID,
  });

  assert.equal(result.eventCount, 2);
  assert.equal(result.score.trust_score, 85);
  assert.equal(result.score.penalty_level, 2);
  assert.equal(result.score.timeout_count, 0);
  assert.equal(result.score.projected_restriction_level, 1);
  assert.equal(result.score.projected_deposit_multiplier, 1);
  assert.ok(calls.some((call) => String(call.sql).includes("FROM trust_events")));
});

test("provider projection rebuild replays historical fulfillments into recovery", async () => {
  const calls = [];
  const historicalEvents = [
    createProviderReportValidatedEvent(1, "2026-01-01T00:00:00.000Z"),
    createProviderFulfillmentEvent(2, "2026-01-02T00:00:00.000Z", {
      food_amount: 100,
    }),
    createProviderFulfillmentEvent(3, "2026-01-03T00:00:00.000Z", {
      food_amount: 100,
    }),
    createProviderFulfillmentEvent(4, "2026-01-04T00:00:00.000Z", {
      food_amount: 100,
    }),
  ];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      if (sql.includes("FROM trust_events") && !sql.includes("JOIN trust_event_effects")) {
        return { rows: historicalEvents };
      }
      if (sql.includes("INSERT INTO trust_scores")) {
        return {
          rows: [
            {
              subject_type: params[0],
              subject_id: params[1],
              trust_score: params[2],
              penalty_level: params[3],
              restriction_level: params[6],
              fulfillment_count: params[11],
              projected_restriction_level: params[13],
              recovery_progress: params[16],
              success_streak: params[18],
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO trust_restrictions")) {
        return { rows: [{ restriction_type: "operational_projection" }] };
      }
      return { rows: [] };
    },
  };

  const result = await rebuildTrustProjectionForSubject(client, {
    subjectType: "provider",
    subjectId: PROVIDER_ID,
  });

  assert.equal(result.eventCount, 4);
  assert.equal(result.projection.trust_score, 98);
  assert.equal(result.projection.penalty_level, 0);
  assert.equal(result.projection.projected_restriction_level, 0);
  assert.equal(result.projection.fulfillment_count, 3);
  assert.equal(result.score.trust_score, 98);
  assert.equal(result.score.penalty_level, 0);
  assert.equal(result.score.projected_restriction_level, 0);
  assert.equal(result.score.fulfillment_count, 3);
  assert.equal(result.score.recovery_progress, 100);
  assert.equal(result.score.success_streak, 1);
  assert.ok(calls.some((call) => String(call.sql).includes("FROM trust_events")));
});

test("applyTrustEventProjection skips duplicate effects without updating scores", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO trust_event_effects")) {
        return { rows: [] };
      }
      throw new Error("score update should not run for duplicate effect");
    },
  };

  const result = await applyTrustEventProjection(client, createEvent());

  assert.equal(result.applied, false);
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((call) => String(call.sql).includes("INSERT INTO trust_scores")));
});

test("claimTrustEvents uses SKIP LOCKED and marks claimed rows processing", async () => {
  const event = createEvent();
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM trust_events")) {
        return { rows: [event] };
      }
      return { rows: [] };
    },
  };

  const rows = await claimTrustEvents(client, { limit: 5 });

  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[1].sql, /processing_status='processing'/);
});

test("processTrustEventBatch is safe across repeated worker passes", async () => {
  const store = {
    event: createEvent(),
    claimed: false,
    processed: false,
    effects: new Set(),
  };
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });

      if (
        sql === "BEGIN" ||
        sql === "COMMIT" ||
        sql === "ROLLBACK" ||
        String(sql).includes("set_config")
      ) {
        return { rows: [] };
      }

      if (String(sql).includes("FROM trust_events")) {
        if (store.claimed || store.processed) return { rows: [] };
        store.claimed = true;
        return { rows: [store.event] };
      }

      if (String(sql).includes("UPDATE trust_events") && String(sql).includes("processing_status='processing'")) {
        return { rows: [] };
      }

      if (String(sql).includes("INSERT INTO trust_event_effects")) {
        const key = params[3];
        if (store.effects.has(key)) return { rows: [] };
        store.effects.add(key);
        return { rows: [{ event_id: params[0] }] };
      }

      if (String(sql).includes("INSERT INTO trust_scores")) {
        return { rows: [{ subject_type: params[0], subject_id: params[1] }] };
      }

      if (String(sql).includes("UPDATE trust_events") && String(sql).includes("processed_at=NOW()")) {
        store.processed = true;
        return { rows: [] };
      }

      if (String(sql).includes("SELECT") && String(sql).includes("COUNT(*) FILTER")) {
        return {
          rows: [
            {
              pending: 0,
              retry: 0,
              failed: 0,
              processed: store.processed ? 1 : 0,
              oldest_pending_lag_ms: 0,
            },
          ],
        };
      }

      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
    async query(sql, params) {
      return client.query(sql, params);
    },
  };

  const first = await processTrustEventBatch({
    pool,
    limit: 1,
    recordOperationalEvent: false,
  });
  store.claimed = false;
  const second = await processTrustEventBatch({
    pool,
    limit: 1,
    recordOperationalEvent: false,
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].processed, true);
  assert.equal(second.length, 0);
  assert.equal(store.effects.size, 1);
  assert.ok(queries.some((query) => String(query.sql).includes("FOR UPDATE SKIP LOCKED")));
});

test("trust worker rolls back projection savepoint before retrying failed event", async () => {
  const badEvent = createEvent({
    id: EVENT_ID,
    event_key: "reservation:abc:bad:user",
  });
  const goodEvent = createEvent({
    id: SECOND_EVENT_ID,
    event_key: "reservation:abc:good:user",
  });
  const store = {
    events: [badEvent, goodEvent],
    attempts: new Map([
      [badEvent.id, 0],
      [goodEvent.id, 0],
    ]),
    statuses: new Map([
      [badEvent.id, "pending"],
      [goodEvent.id, "pending"],
    ]),
    effects: new Set(),
    failedOnce: false,
    processed: new Set(),
    queries: [],
  };

  function createClient() {
    const tx = {
      aborted: false,
      savepoint: false,
    };

    return {
      async query(sql, params = []) {
        const statement = String(sql);
        store.queries.push(statement);

        if (
          tx.aborted &&
          statement !== "ROLLBACK" &&
          !statement.startsWith("ROLLBACK TO SAVEPOINT")
        ) {
          throw new Error("current transaction is aborted, commands ignored until end of transaction block");
        }

        if (statement === "BEGIN" || statement.includes("set_config")) {
          return { rows: [] };
        }
        if (statement === "SAVEPOINT trust_event_projection") {
          tx.savepoint = true;
          return { rows: [] };
        }
        if (statement === "ROLLBACK TO SAVEPOINT trust_event_projection") {
          tx.aborted = false;
          tx.savepoint = false;
          return { rows: [] };
        }
        if (statement === "RELEASE SAVEPOINT trust_event_projection") {
          tx.savepoint = false;
          return { rows: [] };
        }
        if (statement === "COMMIT" || statement === "ROLLBACK") {
          return { rows: [] };
        }

        if (statement.includes("FROM trust_events") && statement.includes("FOR UPDATE SKIP LOCKED")) {
          const exclude = Array.isArray(params[params.length - 1])
            ? new Set(params[params.length - 1])
            : new Set();
          const event = store.events.find(
            (candidate) =>
              !exclude.has(candidate.id) &&
              ["pending", "retry"].includes(store.statuses.get(candidate.id))
          );
          return {
            rows: event
              ? [
                  {
                    ...event,
                    attempt_count: store.attempts.get(event.id),
                    processing_status: store.statuses.get(event.id),
                  },
                ]
              : [],
          };
        }

        if (statement.includes("UPDATE trust_events") && statement.includes("processing_status='processing'")) {
          for (const id of params[0]) {
            store.statuses.set(id, "processing");
            store.attempts.set(id, (store.attempts.get(id) || 0) + 1);
          }
          return { rows: [] };
        }

        if (statement.includes("INSERT INTO trust_event_effects")) {
          if (params[0] === badEvent.id && !store.failedOnce) {
            store.failedOnce = true;
            tx.aborted = true;
            const err = new Error("forced projection SQL failure");
            err.code = "23505";
            throw err;
          }

          if (store.effects.has(params[3])) return { rows: [] };
          store.effects.add(params[3]);
          return { rows: [{ event_id: params[0] }] };
        }

        if (statement.includes("INSERT INTO trust_scores")) {
          return { rows: [{ subject_type: params[0], subject_id: params[1] }] };
        }

        if (statement.includes("UPDATE trust_events") && statement.includes("processed_at=NOW()")) {
          store.statuses.set(params[0], "processed");
          store.processed.add(params[0]);
          return { rows: [] };
        }

        if (statement.includes("UPDATE trust_events") && statement.includes("processing_status=$2")) {
          store.statuses.set(params[0], params[1]);
          return { rows: [] };
        }

        if (statement.includes("SELECT") && statement.includes("COUNT(*) FILTER")) {
          const counts = Array.from(store.statuses.values()).reduce((acc, status) => {
            acc[status] = (acc[status] || 0) + 1;
            return acc;
          }, {});
          return {
            rows: [
              {
                pending: counts.pending || 0,
                retry: counts.retry || 0,
                failed: counts.failed || 0,
                processed: counts.processed || 0,
                oldest_pending_lag_ms: 0,
              },
            ],
          };
        }

        return { rows: [] };
      },
      release() {},
    };
  }

  const fakePool = {
    async connect() {
      return createClient();
    },
    async query(sql, params) {
      return createClient().query(sql, params);
    },
  };

  const results = await processTrustEventBatch({
    pool: fakePool,
    limit: 2,
    maxAttempts: 5,
    recordOperationalEvent: false,
  });

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => result.processed),
    [false, true]
  );
  assert.equal(store.statuses.get(badEvent.id), "retry");
  assert.equal(store.statuses.get(goodEvent.id), "processed");
  assert.equal(store.attempts.get(badEvent.id), 1);
  assert.equal(store.attempts.get(goodEvent.id), 1);
  assert.ok(
    store.queries.some((statement) => statement === "ROLLBACK TO SAVEPOINT trust_event_projection")
  );
});

test("trust worker transaction wrapper rolls back and releases clients on fatal failure", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql) {
      queries.push(String(sql));
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const fakePool = {
    async connect() {
      return client;
    },
  };

  await assert.rejects(
    () =>
      runTrustEventTransaction(
        fakePool,
        async () => {
          const err = new Error("fatal trust transaction failure");
          err.code = "XX001";
          throw err;
        },
        { maxAttempts: 1, name: "trust_test_failure" }
      ),
    /fatal trust transaction failure/
  );

  assert.ok(queries.includes("BEGIN"));
  assert.ok(queries.includes("ROLLBACK"));
  assert.equal(released, true);
});

test("reservation completion derives user and provider trust events", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    listing_id: "88888888-8888-4888-8888-888888888888",
    pickup_type: "self_pickup",
    status: "picked_up",
    task_status: "picked_up",
    completed_at: new Date("2026-01-01T00:00:00.000Z"),
    payment_id: PAYMENT_ID,
    payment_status: "paid",
  });

  assert.deepEqual(
    events.map((event) => event.eventType).sort(),
    ["provider_successful_fulfillment", "user_pickup_completed"]
  );
  assert.ok(events.every((event) => event.eventKey.includes(RESERVATION_ID)));
  assert.equal(
    events.find((event) => event.eventType === "user_pickup_completed").eventPayload.completion_delta,
    1
  );
});

test("payment timeout flow derives user and system events from final reservation state", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    pickup_type: "self_pickup",
    status: "expired_payment",
    task_status: "self_pickup",
    payment_status: "expired",
    payment_id: PAYMENT_ID,
  });

  assert.deepEqual(
    events.map((event) => event.eventType).sort(),
    ["payment_timeout", "user_payment_timeout"]
  );
  assert.equal(
    events.find((event) => event.eventType === "user_payment_timeout").eventPayload.timeout_delta,
    1
  );
});

test("payment failure without lifecycle evidence does not derive user trust penalties", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    pickup_type: "self_pickup",
    status: "payment_failed",
    task_status: "self_pickup",
    payment_status: "failed",
    payment_context: {
      payment_initialization_failed_at: "2026-01-01T00:00:00.000Z",
      stock_restore_reason: "payment_initialization_failed",
    },
  });

  assert.deepEqual(events, []);
});

test("payment failure with a payment row still derives payment timeout penalties", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    pickup_type: "self_pickup",
    status: "payment_failed",
    task_status: "self_pickup",
    payment_status: "failed",
    payment_id: PAYMENT_ID,
    payment_row_status: "failed",
  });

  assert.deepEqual(
    events.map((event) => event.eventType).sort(),
    ["payment_timeout", "user_payment_timeout"]
  );
});

test("recovered payment session without a payment row still counts as user payment lifecycle", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    pickup_type: "self_pickup",
    status: "payment_failed",
    task_status: "self_pickup",
    payment_status: "failed",
    payment_attempt_order_id: "order_test",
    payment_attempt_session_id: "session_test",
  });

  assert.deepEqual(
    events.map((event) => event.eventType).sort(),
    ["payment_timeout", "user_payment_timeout"]
  );
});

test("payment expired status without lifecycle evidence is ignored by trust derivation", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    pickup_type: "self_pickup",
    status: "reserved",
    task_status: "self_pickup",
    payment_status: "expired",
  });

  assert.deepEqual(events, []);
});

test("payment initialization failure audit helper finds legacy user payment events", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return {
        rows: [
          {
            trust_event_id: EVENT_ID,
            event_type: "user_payment_timeout",
            reservation_id: RESERVATION_ID,
          },
        ],
      };
    },
  };

  const rows = await findPaymentInitializationFailureTrustEvents({
    db,
    limit: 25,
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(calls[0].params, [
    ["user_payment_timeout", "user_payment_failed"],
    25,
  ]);
  assert.match(calls[0].sql, /payment_initialization_failed_at/);
  assert.match(calls[0].sql, /stock_restore_reason/);
  assert.match(calls[0].sql, /p\.id IS NULL/);
  assert.match(calls[0].sql, /payment_expires_at IS NULL/);
  assert.match(calls[0].sql, /payment_attempt_session_id/);
});

test("reservation cancellation derives passive cancellation events only", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    pickup_type: "self_pickup",
    status: "cancelled",
    task_status: "self_pickup",
    payment_status: "refund_pending",
    payment_id: PAYMENT_ID,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "user_cancelled_reservation");
  assert.equal(events[0].eventPayload.cancellation_delta, 1);
});

test("NGO delivery derives NGO, volunteer, and provider completion events", () => {
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: NGO_ID,
    provider_id: PROVIDER_ID,
    assigned_volunteer_id: VOLUNTEER_ID,
    pickup_type: "ngo",
    status: "picked_up",
    task_status: "delivered",
    completed_at: new Date("2026-01-01T00:00:00.000Z"),
    payment_status: "not_required",
  });

  assert.deepEqual(
    events.map((event) => event.eventType).sort(),
    [
      "ngo_delivery_completed",
      "provider_successful_fulfillment",
      "volunteer_delivery_completed",
    ]
  );
});

test("volunteer failure taxonomy distinguishes assignment timeout from delivery failure", () => {
  const assignmentTimeout = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: NGO_ID,
    provider_id: PROVIDER_ID,
    assigned_volunteer_id: VOLUNTEER_ID,
    pickup_type: "ngo",
    status: "expired",
    task_status: "failed",
    picked_up_at: null,
  });
  const deliveryFailure = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: NGO_ID,
    provider_id: PROVIDER_ID,
    assigned_volunteer_id: VOLUNTEER_ID,
    pickup_type: "ngo",
    status: "expired",
    task_status: "failed",
    picked_up_at: new Date("2026-01-01T00:05:00.000Z"),
  });

  assert.ok(
    assignmentTimeout.some((event) => event.eventType === "volunteer_assignment_timeout")
  );
  assert.ok(deliveryFailure.some((event) => event.eventType === "volunteer_delivery_failed"));
});

test("payment replay derives deterministic reconciliation and refund event keys", () => {
  const row = {
    id: PAYMENT_ID,
    reservation_id: RESERVATION_ID,
    user_id: USER_ID,
    pickup_type: "self_pickup",
    status: "refunded",
    refund_status: "refunded",
    last_reconciled_at: new Date("2026-01-01T00:00:00.000Z"),
  };

  const first = buildPaymentTrustEvents(row);
  const replay = buildPaymentTrustEvents(row);

  assert.deepEqual(
    replay.map((event) => event.eventKey),
    first.map((event) => event.eventKey)
  );
  assert.deepEqual(
    first.map((event) => event.eventType).sort(),
    ["payment_reconciled", "refund_processed", "user_refund_completed"]
  );
});

test("emitBuiltEvents reports duplicate lifecycle emissions without re-enqueueing", async () => {
  const seen = new Set();
  const events = buildReservationTrustEvents({
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: PROVIDER_ID,
    pickup_type: "self_pickup",
    status: "picked_up",
    task_status: "picked_up",
    completed_at: new Date("2026-01-01T00:00:00.000Z"),
  });

  async function appendTrustEvent(event) {
    const inserted = !seen.has(event.eventKey);
    seen.add(event.eventKey);
    return { inserted, event };
  }

  const first = await emitBuiltEvents(events, { appendTrustEvent });
  const duplicate = await emitBuiltEvents(events, { appendTrustEvent });

  assert.equal(first.every((result) => result.inserted), true);
  assert.equal(duplicate.every((result) => !result.inserted), true);
});
