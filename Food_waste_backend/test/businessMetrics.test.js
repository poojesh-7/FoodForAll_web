const assert = require("node:assert/strict");
const test = require("node:test");

const {
  businessMetricsToCsv,
  getBusinessMetrics,
  normalizeBusinessMetricsFilters,
  windowForPeriod,
} = require("../shared/services/businessMetrics.service");

function createClient() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("total_food_listings")) {
        return {
          rows: [
            {
              total_food_listings: 12,
              total_reservations: 20,
              completed_pickups: 14,
              completed_deliveries: 6,
            },
          ],
        };
      }

      if (sql.includes("total_food_rescued")) {
        return {
          rows: [
            {
              total_food_rescued: 42,
              completed_reservations: 14,
              source_listing_quantity_total: 60,
            },
          ],
        };
      }

      if (sql.includes("active_providers")) {
        return {
          rows: [
            {
              active_providers: 5,
              new_providers: 2,
              verified_providers: 4,
            },
          ],
        };
      }

      if (sql.includes("COUNT(*)::int AS listings")) {
        return {
          rows: [
            {
              provider_id: "11111111-1111-4111-8111-111111111111",
              provider_name: "Green Kitchen",
              listings: 7,
            },
          ],
        };
      }

      if (sql.includes("COUNT(r.id)::int AS reservations") && sql.includes("fl.provider_id")) {
        return {
          rows: [
            {
              provider_id: "11111111-1111-4111-8111-111111111111",
              provider_name: "Green Kitchen",
              reservations: 9,
            },
          ],
        };
      }

      if (sql.includes("COUNT(r.id)::int AS fulfillments")) {
        return {
          rows: [
            {
              provider_id: "11111111-1111-4111-8111-111111111111",
              provider_name: "Green Kitchen",
              fulfillments: 8,
            },
          ],
        };
      }

      if (sql.includes("active_ngos")) {
        return {
          rows: [
            {
              active_ngos: 3,
              new_ngos: 1,
              verified_ngos: 2,
              successful_deliveries: 5,
            },
          ],
        };
      }

      if (sql.includes("AS ngo_name") && sql.includes("AS reservations")) {
        return {
          rows: [
            {
              ngo_user_id: "22222222-2222-4222-8222-222222222222",
              ngo_name: "Helping Hands",
              reservations: 6,
            },
          ],
        };
      }

      if (sql.includes("AS ngo_name") && sql.includes("AS deliveries")) {
        return {
          rows: [
            {
              ngo_user_id: "22222222-2222-4222-8222-222222222222",
              ngo_name: "Helping Hands",
              deliveries: 4,
            },
          ],
        };
      }

      if (sql.includes("active_volunteers")) {
        return {
          rows: [
            {
              active_volunteers: 4,
              completed_deliveries: 8,
              assigned_deliveries: 10,
            },
          ],
        };
      }

      if (sql.includes("AS volunteer_name")) {
        return {
          rows: [
            {
              volunteer_id: "33333333-3333-4333-8333-333333333333",
              volunteer_name: "Asha",
              deliveries: 8,
            },
          ],
        };
      }

      if (sql.includes("AS created") && sql.includes("AS cancellation_rate") === false) {
        return {
          rows: [
            {
              created: 20,
              completed: 14,
              cancelled: 3,
              expired: 2,
            },
          ],
        };
      }

      if (sql.includes("average_trust_score")) {
        return {
          rows: [
            {
              average_trust_score: 91.25,
              restricted_entities: 2,
              cooldown_entities: 1,
              deposit_1x: 10,
              deposit_1_5x: 3,
              deposit_2x: 1,
              deposit_gt_2x: 0,
            },
          ],
        };
      }

      if (sql.includes("reports_submitted")) {
        return {
          rows: [
            {
              reports_submitted: 6,
              reports_validated: 2,
              reports_dismissed: 1,
              moderation_cases: 5,
              appeals_submitted: 2,
              appeals_accepted: 1,
              appeals_rejected: 1,
            },
          ],
        };
      }

      if (sql.includes("settlements_generated")) {
        return {
          rows: [
            {
              settlements_generated: 4,
              settlements_completed: 3,
              refunds_processed: 2,
            },
          ],
        };
      }

      if (sql.includes("WITH days AS")) {
        return {
          rows: [
            {
              bucket: "2026-06-07",
              listings: 2,
              reservations: 3,
              deliveries: 1,
              reports: 1,
              settlements: 1,
            },
          ],
        };
      }

      return { rows: [] };
    },
  };
}

function hasMutation(calls) {
  return calls.some((call) =>
    /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(call.sql)
  );
}

test("business metrics aggregate dashboard data without mutating business state", async () => {
  const client = createClient();

  const metrics = await getBusinessMetrics({
    client,
    period: "90d",
  });

  assert.equal(metrics.informational_only, true);
  assert.equal(metrics.enforcement_action, null);
  assert.equal(metrics.filters.period, "90d");
  assert.equal(metrics.platform.selected.total_food_listings, 12);
  assert.equal(metrics.platform.period_summaries.length, 5);
  assert.equal(metrics.food_rescue.total_food_rescued, 42);
  assert.equal(metrics.food_rescue.unit, "platform_quantity_units");
  assert.equal(metrics.provider_participation.counts.active_providers, 5);
  assert.equal(metrics.provider_participation.top_providers.by_fulfillments[0].fulfillments, 8);
  assert.equal(metrics.ngo_participation.counts.successful_deliveries, 5);
  assert.equal(metrics.volunteer_participation.counts.completion_rate, 80);
  assert.equal(metrics.reservation_performance.completion_rate, 70);
  assert.equal(metrics.trust_insights.average_trust_score, 91.25);
  assert.equal(metrics.governance_insights.reports_validated, 2);
  assert.equal(metrics.financial_insights.recalculates_ledgers, false);
  assert.equal(metrics.trend_analytics.series.length, 1);
  assert.equal(hasMutation(client.calls), false);
});

test("business metrics filters normalize supported windows", () => {
  assert.equal(normalizeBusinessMetricsFilters({ period: "365" }).period, "365d");
  assert.equal(normalizeBusinessMetricsFilters({ windowDays: 180 }).period, "180d");
  assert.equal(normalizeBusinessMetricsFilters({ period: "all_time" }).period, "all");
  assert.equal(normalizeBusinessMetricsFilters({ period: "unexpected" }).period, "30d");

  const allWindow = windowForPeriod("all", new Date("2026-06-08T00:00:00.000Z"));
  assert.equal(allWindow.start_at, null);
  assert.equal(allWindow.end_at, "2026-06-08T00:00:00.000Z");
});

test("business metrics CSV export carries dashboard values and source lineage", async () => {
  const client = createClient();
  const metrics = await getBusinessMetrics({ client, period: "30d" });
  const csv = businessMetricsToCsv(metrics);

  assert.match(csv, /platform_overview/);
  assert.match(csv, /total_food_rescued/);
  assert.match(csv, /platform_quantity_units/);
  assert.match(csv, /provider_settlements/);
  assert.match(csv, /trust_scores/);
});
