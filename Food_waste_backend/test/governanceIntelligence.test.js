const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getGovernanceIntelligenceSummary,
  listGovernanceSignals,
  listProviderGovernanceMetrics,
  listReporterReputations,
  normalizeFilters,
} = require("../shared/services/governanceIntelligence.service");

const REPORTER_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";

function createClient() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("rb.reported_by AS reporter_id")) {
        return {
          rows: [
            {
              reporter_id: REPORTER_ID,
              reporter_name: "Helping NGO",
              reporter_role: "ngo",
              reports_submitted: 10,
              reports_validated: 2,
              reports_dismissed: 8,
              reports_pending: 0,
              unique_providers_reported: 2,
              repeated_target_count: 1,
              max_reports_against_single_provider: 5,
              linked_appeals_submitted: 3,
              accepted_appeal_reversals: 2,
              first_report_at: "2026-06-01T00:00:00.000Z",
              last_report_at: "2026-06-06T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("cb.provider_id") && sql.includes("reports_received")) {
        return {
          rows: [
            {
              provider_id: PROVIDER_ID,
              provider_name: "Green Kitchen",
              reports_received: 6,
              reports_validated: 4,
              reports_dismissed: 2,
              reports_pending: 0,
              total_cases: 6,
              open_cases: 1,
              validated_cases: 3,
              dismissed_cases: 2,
              cases_escalated: 3,
              escalation_events: 4,
              appeals_submitted: 4,
              appeals_accepted: 2,
              appeals_rejected: 1,
              first_case_at: "2026-06-01T00:00:00.000Z",
              last_case_at: "2026-06-06T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("GROUP BY mc.assigned_admin_id")) {
        return {
          rows: [
            {
              admin_id: "44444444-4444-4444-8444-444444444444",
              admin_name: "Admin User",
              cases_reviewed: 5,
              cases_validated: 3,
              cases_dismissed: 2,
              cases_escalated: 1,
              average_resolution_hours: 5.25,
            },
          ],
        };
      }

      if (sql.includes("FROM moderation_cases") && sql.includes("average_resolution_hours")) {
        return {
          rows: [
            {
              total_cases: 6,
              open_cases: 1,
              validated_cases: 3,
              dismissed_cases: 2,
              escalated_cases: 1,
              average_resolution_hours: 5.25,
            },
          ],
        };
      }

      if (sql.includes("FROM moderation_appeals") && sql.includes("appeals_submitted")) {
        return {
          rows: [
            {
              appeals_submitted: 4,
              appeals_under_review: 1,
              appeals_accepted: 2,
              appeals_rejected: 1,
              appeals_withdrawn: 0,
            },
          ],
        };
      }

      if (sql.includes("WITH case_base AS") && sql.includes("escalation_events")) {
        return {
          rows: [
            {
              total_cases: 6,
              cases_escalated: 3,
              escalation_events: 4,
            },
          ],
        };
      }

      if (sql.includes("WITH provider_escalations AS")) {
        return {
          rows: [
            {
              provider_id: PROVIDER_ID,
              provider_name: "Green Kitchen",
              cases_escalated: 3,
              escalation_events: 4,
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

test("reporter reputation exposes validation and false-reporting signals", async () => {
  const client = createClient();

  const reporters = await listReporterReputations({ client, windowDays: 90 });

  assert.equal(reporters.length, 1);
  assert.equal(reporters[0].reports_submitted, 10);
  assert.equal(reporters[0].reports_dismissed, 8);
  assert.equal(reporters[0].validation_rate, 20);
  assert.equal(reporters[0].risk_level, "HIGH");
  assert.ok(
    reporters[0].signals.some(
      (signal) =>
        signal.signal_type === "HIGH_DISMISSAL_REPORTER" &&
        signal.supporting_counts.some((count) => count.label === "Reports dismissed")
    )
  );
  assert.equal(reporters[0].informational_only, true);
  assert.equal(hasMutation(client.calls), false);
});

test("provider governance metrics expose appeal and escalation patterns", async () => {
  const client = createClient();

  const providers = await listProviderGovernanceMetrics({ client, windowDays: 90 });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].reports_received, 6);
  assert.equal(providers[0].cases_escalated, 3);
  assert.equal(providers[0].escalation_rate, 50);
  assert.equal(providers[0].risk_level, "HIGH");
  assert.ok(
    providers[0].signals.some(
      (signal) =>
        signal.signal_type === "HIGH_ESCALATION_PROVIDER" &&
        signal.metrics.escalation_events === 4
    )
  );
  assert.equal(providers[0].informational_only, true);
  assert.equal(hasMutation(client.calls), false);
});

test("governance summary aggregates dashboard data without enforcement actions", async () => {
  const client = createClient();

  const summary = await getGovernanceIntelligenceSummary({ client, limit: 10 });

  assert.equal(summary.informational_only, true);
  assert.equal(summary.enforcement_action, null);
  assert.equal(summary.moderation.open_cases, 1);
  assert.equal(summary.moderation.appeals_accepted, 2);
  assert.equal(summary.escalation.escalation_rate, 50);
  assert.ok(summary.signals.length >= 4);
  assert.ok(summary.signals.every((signal) => signal.informational_only));
  assert.equal(hasMutation(client.calls), false);
});

test("signal listing supports explicit risk filtering", async () => {
  const client = createClient();

  const signals = await listGovernanceSignals({
    client,
    risk: "HIGH",
    windowDays: 90,
  });

  assert.ok(signals.length > 0);
  assert.ok(signals.every((signal) => signal.risk_level === "HIGH"));
  assert.equal(hasMutation(client.calls), false);
});

test("governance filters reject invalid identifiers and normalize ranges", () => {
  assert.throws(
    () => normalizeFilters({ reporterId: "not-a-uuid" }),
    /Invalid reporter filter/
  );

  const filters = normalizeFilters({ windowDays: 9999, limit: 9999, risk: "medium" });
  assert.equal(filters.windowDays, 365);
  assert.equal(filters.limit, 100);
  assert.equal(filters.risk, "MEDIUM");
});
