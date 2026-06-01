const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateReservationSpamGuard,
  getReservationHoldCounters,
  holdLimitForTier,
  trustTierFromScore,
} = require("../shared/services/abuseGuard.service");

function withEnv(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = String(value);
  }

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function createGuardClient({ trustScore = null, counters = {} } = {}) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql: String(sql), params });
      if (String(sql).includes("FROM trust_scores")) {
        return trustScore === null
          ? { rows: [] }
          : { rows: [{ trust_score: trustScore, risk_category: "normal" }] };
      }
      if (String(sql).includes("FROM reservations")) {
        return {
          rows: [
            {
              active_unpaid_holds: counters.activeUnpaidHolds || 0,
              abandoned_payment_holds: counters.abandonedPaymentHolds || 0,
              expired_payment_holds: counters.expiredPaymentHolds || 0,
              abandoned_reservation_count: counters.abandonedReservationCount || 0,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

test("reservation spam guard blocks low-trust users at a lower unpaid hold limit", async () => {
  await withEnv(
    {
      MAX_UNPAID_HOLDS_LOW_TRUST: 1,
      MAX_UNPAID_HOLDS_NORMAL: 3,
      MAX_UNPAID_HOLDS_HIGH_TRUST: 4,
      TRUST_LOW_SCORE_THRESHOLD: 70,
      TRUST_HIGH_SCORE_THRESHOLD: 95,
      ABUSE_GUARD_RECORD_OPERATIONAL_EVENTS: "false",
    },
    async () => {
      const client = createGuardClient({
        trustScore: 50,
        counters: { activeUnpaidHolds: 1 },
      });

      await assert.rejects(
        () => evaluateReservationSpamGuard(client, "11111111-1111-4111-8111-111111111111"),
        (err) => err.statusCode === 429 && err.reason === "reservation_spam_blocked"
      );
    }
  );
});

test("reservation spam guard preserves normal trust pending-payment behavior", async () => {
  await withEnv({ MAX_UNPAID_HOLDS_NORMAL: 3 }, async () => {
    const client = createGuardClient({
      trustScore: 85,
      counters: { activeUnpaidHolds: 2 },
    });

    const result = await evaluateReservationSpamGuard(
      client,
      "11111111-1111-4111-8111-111111111111"
    );

    assert.equal(result.allowed, true);
    assert.equal(result.trust.tier, "normal");
    assert.equal(result.limit, 3);
  });
});

test("reservation hold counters track expired and abandoned holds separately", async () => {
  const client = createGuardClient({
    counters: {
      activeUnpaidHolds: 0,
      abandonedPaymentHolds: 2,
      expiredPaymentHolds: 3,
      abandonedReservationCount: 5,
    },
  });

  const counters = await getReservationHoldCounters(
    client,
    "11111111-1111-4111-8111-111111111111",
    { lookbackHours: 24 }
  );

  assert.equal(counters.activeUnpaidHolds, 0);
  assert.equal(counters.abandonedPaymentHolds, 2);
  assert.equal(counters.expiredPaymentHolds, 3);
  assert.equal(counters.abandonedReservationCount, 5);
});

test("trust tier hold limits are configurable", () => {
  const config = {
    trustLowScoreThreshold: 70,
    trustHighScoreThreshold: 95,
    maxUnpaidHoldsLowTrust: 1,
    maxUnpaidHoldsNormal: 3,
    maxUnpaidHoldsHighTrust: 5,
  };

  assert.equal(trustTierFromScore(60, config), "low");
  assert.equal(trustTierFromScore(90, config), "normal");
  assert.equal(trustTierFromScore(99, config), "high");
  assert.equal(holdLimitForTier("low", config), 1);
  assert.equal(holdLimitForTier("normal", config), 3);
  assert.equal(holdLimitForTier("high", config), 5);
});
