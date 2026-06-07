const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getGovernanceDashboard,
  normalizeDashboardFilters,
} = require("../shared/services/governanceDashboard.service");

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const REPORTER_ID = "22222222-2222-4222-8222-222222222222";

function createClient() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("open_cases") && sql.includes("FROM moderation_cases")) {
        return {
          rows: [
            {
              open_cases: 3,
              under_review_cases: 2,
              awaiting_response_cases: 1,
              escalated_cases: 1,
              active_cases: 7,
            },
          ],
        };
      }

      if (sql.includes("appeals_pending_review")) {
        return {
          rows: [
            {
              appeals_pending_review: 4,
              appeals_under_review: 2,
              appeals_accepted: 1,
              appeals_rejected: 1,
            },
          ],
        };
      }

      if (sql.includes("provider_response_count")) {
        const status = params[0] || "OPEN";
        return {
          rows: [
            {
              id: `${String(status).toLowerCase()}-case`,
              case_type: "provider_report",
              subject_type: "provider",
              subject_id: PROVIDER_ID,
              subject_name: "Green Kitchen",
              status,
              reason: "unsafe_food",
              summary: "Reported unsafe food.",
              source_report_id: "report-1",
              created_at: "2026-06-01T00:00:00.000Z",
              updated_at: "2026-06-02T00:00:00.000Z",
              report_id: "report-1",
              report_reason: "unsafe_food",
              report_status: "pending",
              reporter_name: "Helping NGO",
              reporter_role: "ngo",
              listing_title: "Surplus meals",
              provider_response_count: 1,
              appeal_count: 0,
              latest_event_type: "CASE_OPENED",
              latest_event_at: "2026-06-01T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("'moderation_case_event' AS source_type")) {
        return {
          rows: [
            {
              source_type: "moderation_case_event",
              id: "event-1",
              case_id: "open-case",
              actor_user_id: REPORTER_ID,
              actor_name: "Helping NGO",
              actor_role: "ngo",
              event_type: "CASE_OPENED",
              created_at: "2026-06-05T00:00:00.000Z",
              case_status: "OPEN",
              subject_id: PROVIDER_ID,
              subject_name: "Green Kitchen",
            },
          ],
        };
      }

      if (sql.includes("ma.status = $1")) {
        return {
          rows: [
            {
              id: `${String(params[0]).toLowerCase()}-appeal`,
              case_id: "open-case",
              provider_id: PROVIDER_ID,
              provider_name: "Green Kitchen",
              status: params[0],
              submitted_at: "2026-06-04T00:00:00.000Z",
              reviewed_at: "2026-06-05T00:00:00.000Z",
              case_status: "VALIDATED",
              report_reason: "unsafe_food",
              listing_title: "Surplus meals",
            },
          ],
        };
      }

      if (sql.includes("restricted_actors") && sql.includes("FROM trust_scores")) {
        return {
          rows: [
            {
              restricted_actors: 2,
              cooldown_actors: 1,
              high_deposit_multiplier_actors: 1,
              high_risk_trust_actors: 1,
            },
          ],
        };
      }

      if (sql.includes("FROM trust_scores ts")) {
        return {
          rows: [
            {
              subject_type: "provider",
              subject_id: PROVIDER_ID,
              actor_name: "Green Kitchen",
              actor_role: "provider",
              trust_score: 71,
              penalty_level: 2,
              restriction_level: 1,
              cooldown_until: null,
              deposit_multiplier: 1.5,
              risk_category: "high",
              recovery_progress: 40,
              updated_at: "2026-06-05T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("FROM admin_trust_actions ata")) {
        return {
          rows: [
            {
              id: "action-1",
              admin_user_id: "33333333-3333-4333-8333-333333333333",
              admin_name: "Admin User",
              subject_type: "provider",
              subject_id: PROVIDER_ID,
              subject_name: "Green Kitchen",
              action_type: "TRUST_REVIEW_FLAG",
              reason: "Manual review.",
              created_at: "2026-06-05T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("FROM notifications n")) {
        return {
          rows: [
            {
              id: "notification-1",
              user_id: "33333333-3333-4333-8333-333333333333",
              recipient_name: "Admin User",
              type: "moderation_case_escalated",
              title: "Operational update",
              message: "Moderation case escalated for review.",
              is_read: false,
              created_at: "2026-06-05T00:00:00.000Z",
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

function intelligence() {
  return {
    generated_at: "2026-06-05T00:00:00.000Z",
    filters: { window_days: 90, limit: 25 },
    window: {
      days: 90,
      start_at: "2026-03-07T00:00:00.000Z",
      end_at: "2026-06-05T00:00:00.000Z",
    },
    informational_only: true,
    enforcement_action: null,
    moderation: {},
    reporters: [
      {
        reporter_id: REPORTER_ID,
        reporter_name: "Helping NGO",
        risk_level: "HIGH",
        reports_submitted: 10,
        reports_validated: 2,
        reports_dismissed: 8,
        accepted_appeal_reversals: 2,
        informational_only: true,
      },
    ],
    providers: [
      {
        provider_id: PROVIDER_ID,
        provider_name: "Green Kitchen",
        risk_level: "HIGH",
        cases_escalated: 3,
        appeals_submitted: 4,
        informational_only: true,
      },
      {
        provider_id: PROVIDER_ID,
        provider_name: "Green Kitchen",
        risk_level: "HIGH",
        cases_escalated: 3,
        appeals_submitted: 4,
        informational_only: true,
      },
    ],
    escalation: {},
    signals: [
      {
        id: "provider:high-escalation",
        actor_type: "provider",
        actor_id: PROVIDER_ID,
        actor_name: "Green Kitchen",
        signal_type: "HIGH_ESCALATION_PROVIDER",
        title: "High Escalation Provider",
        risk_level: "HIGH",
        reason: "3 cases escalated.",
        informational_only: true,
        enforcement_action: null,
      },
      {
        id: "provider:high-escalation",
        actor_type: "provider",
        actor_id: PROVIDER_ID,
        actor_name: "Green Kitchen",
        signal_type: "HIGH_ESCALATION_PROVIDER",
        title: "High Escalation Provider",
        risk_level: "HIGH",
        reason: "3 cases escalated.",
        informational_only: true,
        enforcement_action: null,
      },
      {
        id: "reporter:appeal-reversal",
        actor_type: "reporter",
        actor_id: REPORTER_ID,
        actor_name: "Helping NGO",
        signal_type: "APPEAL_REVERSAL_PATTERN",
        title: "Appeal Reversal Pattern",
        risk_level: "HIGH",
        reason: "2 accepted appeals.",
        informational_only: true,
        enforcement_action: null,
      },
    ],
  };
}

function uniqueCount(items, keyFn) {
  return new Set(items.map(keyFn)).size;
}

test("governance dashboard aggregates read-only governance operations data", async () => {
  const client = createClient();

  const dashboard = await getGovernanceDashboard({
    client,
    intelligence: intelligence(),
    windowDays: 90,
    limit: 25,
  });

  assert.equal(dashboard.informational_only, true);
  assert.equal(dashboard.enforcement_action, null);
  assert.equal(dashboard.overview.counts.open_cases, 3);
  assert.equal(dashboard.overview.counts.appeals_pending_review, 4);
  assert.equal(dashboard.overview.counts.governance_signals, 2);
  assert.equal(dashboard.overview.counts.high_risk_actors, 3);
  assert.ok(dashboard.overview.cards.every((card) => card.href && card.source));
  assert.equal(dashboard.moderation.current_queue[0].href, "/admin/moderation-cases/open-case");
  assert.equal(dashboard.trust.restricted_actors[0].href.includes("/admin/trust"), true);
  assert.equal(dashboard.trust.visibility_actors.length, 1);
  assert.equal(
    dashboard.trust.visibility_actors.length,
    uniqueCount(
      dashboard.trust.visibility_actors,
      (actor) => `${actor.subject_type}:${actor.subject_id}`
    )
  );
  assert.equal(dashboard.high_risk_actors.providers.length, 1);
  assert.equal(
    dashboard.high_risk_actors.providers.length,
    uniqueCount(
      dashboard.high_risk_actors.providers,
      (provider) => `provider:${provider.provider_id}`
    )
  );
  assert.equal(dashboard.intelligence.top_signals.length, 2);
  assert.equal(dashboard.intelligence.high_escalation_providers.length, 1);
  assert.equal(dashboard.notifications.recent_activity.length, 1);
  assert.equal(hasMutation(client.calls), false);
});

test("governance dashboard filters normalize bounds without changing intelligence rules", () => {
  const filters = normalizeDashboardFilters({
    windowDays: 999,
    limit: 999,
    queueLimit: "not-a-number",
    activityLimit: 1000,
  });

  assert.equal(filters.windowDays, 365);
  assert.equal(filters.limit, 100);
  assert.equal(filters.queueLimit, 10);
  assert.equal(filters.activityLimit, 50);
});
