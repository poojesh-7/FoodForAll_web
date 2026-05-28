const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildReplayDiagnostics,
  buildReplayLineage,
  getRecentTrustEvents,
  getTrustAnomalySummary,
  normalizeTrustFilters,
  trustReplayChecksum,
} = require("../shared/services/trustObservability.service");
const {
  buildTrustProjectionFromEvents,
} = require("../shared/services/trustProjection.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";

function createEvent(index, eventType, payload, createdAt, overrides = {}) {
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
    event_key: `trust:observability:${index}:${eventType}`,
    subject_type: "user",
    subject_id: USER_ID,
    source_type: "reservation",
    source_id: `reservation-${index}`,
    event_type: eventType,
    event_payload: {
      ...payload,
      metadata: {
        source_lineage: `test.${eventType}`,
        ...(payload.metadata || {}),
      },
    },
    processing_status: "processed",
    created_at: new Date(createdAt),
    ...overrides,
  };
}

test("trust replay diagnostics validate deterministic projection consistency", () => {
  const events = [
    createEvent(1, "user_pickup_failed", {
      score_delta: -10,
      failure_delta: 1,
    }, "2026-01-01T00:00:00.000Z"),
    createEvent(2, "user_pickup_completed", {
      score_delta: 3,
      completion_delta: 1,
    }, "2026-01-02T00:00:00.000Z"),
  ];
  const projection = buildTrustProjectionFromEvents(events, "user", USER_ID);

  const diagnostics = buildReplayDiagnostics({
    events,
    storedProjection: projection,
    subjectType: "user",
    subjectId: USER_ID,
  });
  const mismatch = buildReplayDiagnostics({
    events,
    storedProjection: { ...projection, trust_score: projection.trust_score - 1 },
    subjectType: "user",
    subjectId: USER_ID,
  });

  assert.equal(diagnostics.consistent, true);
  assert.equal(diagnostics.checksumMatch, true);
  assert.equal(diagnostics.mismatchCount, 0);
  assert.equal(mismatch.consistent, false);
  assert.equal(mismatch.mismatches[0].field, "trust_score");
});

test("trust projection lineage remains deterministic across event order", () => {
  const events = [
    createEvent(1, "provider_listing_expired", {
      analytics_only: true,
      trust_impact: "neutral",
      metadata: { source_lineage: "listing.expired" },
    }, "2026-01-03T00:00:00.000Z", {
      subject_type: "provider",
      subject_id: PROVIDER_ID,
      source_type: "food_listing",
      source_id: "listing-1",
    }),
    createEvent(2, "provider_report_validated", {
      score_delta: -15,
      failure_delta: 1,
      metadata: { source_lineage: "provider_report.validated" },
    }, "2026-01-04T00:00:00.000Z", {
      subject_type: "provider",
      subject_id: PROVIDER_ID,
      source_type: "provider_report",
      source_id: "report-1",
    }),
  ];

  const lineage = buildReplayLineage(events);
  const checksum = trustReplayChecksum(events);
  const reversedChecksum = trustReplayChecksum([...events].reverse());

  assert.equal(lineage.eventCount, 2);
  assert.equal(checksum, reversedChecksum);
  assert.deepEqual(
    lineage.sourceLineage.map((item) => item.lineage).sort(),
    ["listing.expired", "provider_report.validated"]
  );
});

test("trust anomaly summary reports duplicate source groups", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });

      if (String(sql).includes("MAX(te.created_at) AS newest_event_at")) {
        return { rows: [] };
      }
      if (String(sql).includes("LEFT JOIN trust_event_effects")) {
        return { rows: [] };
      }
      if (String(sql).includes("GROUP BY source_type, source_id")) {
        return {
          rows: [
            {
              source_type: "reservation",
              source_id: "reservation-1",
              event_type: "user_payment_timeout",
              subject_type: "user",
              subject_id: USER_ID,
              duplicate_count: 2,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const anomalies = await getTrustAnomalySummary({
    db,
    actorType: "user",
    eventType: "user_payment_timeout",
    sinceDays: 7,
    limit: 5,
  });

  assert.equal(anomalies.duplicateSourceGroups.length, 1);
  assert.equal(anomalies.duplicateSourceGroups[0].duplicate_count, 2);
  assert.ok(calls.every((call) => !call.sql.includes("user_payment_timeout")));
  assert.ok(calls.some((call) => call.params.includes("user_payment_timeout")));
});

test("recent trust events query uses stable admin-safe filtering", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return {
        rows: [
          {
            id: "event-1",
            event_type: "user_payment_timeout",
            subject_type: "user",
          },
        ],
      };
    },
  };

  const result = await getRecentTrustEvents({
    db,
    actorType: "user",
    eventType: "user_payment_timeout",
    sinceDays: 14,
    limit: 7,
  });

  assert.equal(result.events.length, 1);
  assert.deepEqual(calls[0].params, [14, "user", "user_payment_timeout", 7]);
  assert.match(calls[0].sql, /ORDER BY te\.created_at DESC, te\.id DESC/);
  assert.match(calls[0].sql, /LIMIT \$4/);
  assert.ok(!calls[0].sql.includes("user_payment_timeout"));
});

test("trust observability filters reject unsafe values", () => {
  assert.throws(
    () => normalizeTrustFilters({ actorType: "provider;drop" }),
    /Invalid trust actor type/
  );
  assert.throws(
    () => normalizeTrustFilters({ eventType: "user_payment_timeout;drop" }),
    /Invalid trust event type/
  );
});
