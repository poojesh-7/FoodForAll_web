const assert = require("node:assert/strict");
const test = require("node:test");

const {
  appendTrustEvent,
  claimTrustEvents,
} = require("../shared/services/trustEvent.service");
const {
  applyTrustEventProjection,
  buildTrustEffect,
} = require("../shared/services/trustProjection.service");
const {
  processTrustEventBatch,
} = require("../shared/services/trustWorker.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

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

test("applyTrustEventProjection applies score once per effect hash", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO trust_event_effects")) {
        return { rows: [{ event_id: params[0] }] };
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
      return { rows: [] };
    },
  };

  const result = await applyTrustEventProjection(client, createEvent());

  assert.equal(result.applied, true);
  assert.equal(result.score.trust_score, 100);
  assert.equal(calls.length, 2);
});

test("applyTrustEventProjection skips duplicate effects without updating scores", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO trust_event_effects")) {
        return { rows: [] };
      }
      throw new Error("score update should not run for duplicate effect");
    },
  };

  const result = await applyTrustEventProjection(client, createEvent());

  assert.equal(result.applied, false);
  assert.equal(calls.length, 1);
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
