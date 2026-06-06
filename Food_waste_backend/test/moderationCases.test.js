const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createProviderReport,
  dismissProviderReport,
  getModerationCaseDetail,
  transitionModerationCaseStatus,
  validateProviderReport,
} = require("../shared/services/moderation.service");

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const REPORTER_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const CASE_ID = "66666666-6666-4666-8666-666666666666";

function providerReport(status = "pending", moderationCaseId = CASE_ID) {
  return {
    id: REPORT_ID,
    provider_id: PROVIDER_ID,
    reported_by: REPORTER_ID,
    reservation_id: RESERVATION_ID,
    moderation_case_id: moderationCaseId,
    reason: "unsafe_food",
    description: "Food smelled unsafe.",
    status,
    created_at: "2026-06-05T00:00:00.000Z",
    resolved_at: status === "pending" ? null : "2026-06-05T01:00:00.000Z",
    reviewed_by_admin: status === "pending" ? null : ADMIN_ID,
  };
}

function moderationCase(status = "OPEN") {
  return {
    id: CASE_ID,
    case_type: "provider_report",
    subject_type: "provider",
    subject_id: PROVIDER_ID,
    status,
    opened_by_user_id: REPORTER_ID,
    assigned_admin_id: status === "OPEN" ? null : ADMIN_ID,
    source_report_id: REPORT_ID,
    reason: "unsafe_food",
    summary: "Food smelled unsafe.",
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
    closed_at: null,
  };
}

function createClient() {
  const calls = [];
  let currentCase = moderationCase("OPEN");
  let createdCaseCount = 0;
  let eventCount = 0;

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("FROM users") && sql.includes("WHERE id=$1")) {
        return {
          rows: [
            {
              id: params[0],
              role: "admin",
              is_verified: true,
              banned_until: null,
              cooldown_until: null,
              requires_reliability_deposit: false,
              restriction_level: 0,
              restriction_reason: null,
            },
          ],
        };
      }

      if (sql.includes("SELECT id") && sql.includes("FROM provider_reports")) {
        return { rows: [] };
      }

      if (sql.includes("COUNT(*)::int AS report_count")) {
        return { rows: [{ report_count: 0 }] };
      }

      if (sql.includes("INSERT INTO provider_reports")) {
        return { rows: [providerReport("pending", null)] };
      }

      if (sql.includes("INSERT INTO moderation_cases") && sql.includes("VALUES (")) {
        createdCaseCount += 1;
        currentCase = {
          ...moderationCase(params[1] || "OPEN"),
          id: CASE_ID,
        };
        return { rows: [currentCase] };
      }

      if (sql.includes("UPDATE provider_reports") && sql.includes("moderation_case_id")) {
        return { rows: [] };
      }

      if (sql.includes("FROM moderation_case_events") && sql.includes("CASE_OPENED")) {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO moderation_case_events") && sql.includes("VALUES")) {
        eventCount += 1;
        return {
          rows: [
            {
              id: `event-${eventCount}`,
              case_id: params[0],
              actor_user_id: params[1],
              event_type: params[2],
              from_status: params[3],
              to_status: params[4],
              note: params[5],
              metadata: JSON.parse(params[6] || "{}"),
              created_at: "2026-06-05T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("UPDATE provider_reports") && sql.includes("status='validated'")) {
        return { rows: [providerReport("validated")] };
      }

      if (sql.includes("UPDATE provider_reports") && sql.includes("status='dismissed'")) {
        return { rows: [providerReport("dismissed")] };
      }

      if (sql.includes("SELECT *") && sql.includes("FROM moderation_cases")) {
        return { rows: [currentCase] };
      }

      if (sql.includes("UPDATE moderation_cases")) {
        currentCase = {
          ...currentCase,
          status: params[1],
          assigned_admin_id: ADMIN_ID,
          updated_at: "2026-06-05T01:00:00.000Z",
          closed_at: ["VALIDATED", "DISMISSED"].includes(params[1])
            ? "2026-06-05T01:00:00.000Z"
            : null,
        };
        return { rows: [currentCase] };
      }

      if (sql.includes("INSERT INTO trust_events")) {
        return {
          rows: [
            {
              id: "trust-event-1",
              event_key: params[0],
              event_type: params[7],
            },
          ],
        };
      }

      if (sql.includes("FROM moderation_cases mc")) {
        return {
          rows: [
            {
              case_id: CASE_ID,
              case_type: "provider_report",
              subject_type: "provider",
              subject_id: PROVIDER_ID,
              case_status: currentCase.status,
              opened_by_user_id: REPORTER_ID,
              assigned_admin_id: currentCase.assigned_admin_id,
              source_report_id: REPORT_ID,
              case_reason: "unsafe_food",
              case_summary: "Food smelled unsafe.",
              case_created_at: "2026-06-05T00:00:00.000Z",
              case_updated_at: currentCase.updated_at,
              closed_at: currentCase.closed_at,
              provider_name: "Green Kitchen",
              assigned_admin_name: "Admin User",
              report_id: REPORT_ID,
              report_provider_id: PROVIDER_ID,
              reported_by: REPORTER_ID,
              reservation_id: RESERVATION_ID,
              report_reason: "unsafe_food",
              report_description: "Food smelled unsafe.",
              report_status: currentCase.status === "DISMISSED"
                ? "dismissed"
                : currentCase.status === "VALIDATED"
                  ? "validated"
                  : "pending",
              report_created_at: "2026-06-05T00:00:00.000Z",
              resolved_at: currentCase.closed_at,
              reviewed_by_admin: currentCase.assigned_admin_id,
              reporter_name: "Helping NGO",
              reporter_role: "ngo",
              reservation_pickup_type: "ngo",
              reservation_status: "completed",
              reservation_task_status: "delivered",
              listing_title: "Lunch boxes",
              attachments: [
                {
                  id: "attachment-1",
                  file_url: "https://res.cloudinary.com/demo/image/upload/evidence.webp",
                },
              ],
            },
          ],
        };
      }

      if (sql.includes("FROM moderation_case_events mce")) {
        return {
          rows: [
            {
              id: "event-1",
              case_id: CASE_ID,
              actor_user_id: REPORTER_ID,
              actor_name: "Helping NGO",
              actor_role: "ngo",
              event_type: "CASE_OPENED",
              from_status: null,
              to_status: "OPEN",
              note: null,
              metadata: {},
              created_at: "2026-06-05T00:00:00.000Z",
            },
          ],
        };
      }

      return { rows: [] };
    },
    get createdCaseCount() {
      return createdCaseCount;
    },
  };
}

test("provider report creation opens a linked moderation case with timeline", async () => {
  const client = createClient();

  const report = await createProviderReport({
    client,
    providerId: PROVIDER_ID,
    reportedBy: REPORTER_ID,
    reservationId: RESERVATION_ID,
    reason: "unsafe_food",
    description: "Food smelled unsafe.",
    applyCooldown: false,
  });

  assert.equal(report.moderation_case_id, CASE_ID);
  assert.equal(report.moderation_case_status, "OPEN");
  assert.equal(client.createdCaseCount, 1);
  assert.ok(client.calls.some((call) => call.sql.includes("INSERT INTO moderation_cases")));
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_OPENED"
    )
  );
});

test("moderation case status transition writes audit history", async () => {
  const client = createClient();

  const updated = await transitionModerationCaseStatus({
    client,
    caseId: CASE_ID,
    adminId: ADMIN_ID,
    status: "UNDER_REVIEW",
    note: "Checking evidence.",
  });

  assert.equal(updated.status, "UNDER_REVIEW");
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_STATUS_CHANGED" &&
        call.params[3] === "OPEN" &&
        call.params[4] === "UNDER_REVIEW" &&
        call.params[5] === "Checking evidence."
    )
  );
});

test("validated provider report preserves trust penalty path and closes case", async () => {
  const client = createClient();

  const report = await validateProviderReport({
    client,
    reportId: REPORT_ID,
    adminId: ADMIN_ID,
  });

  assert.equal(report.status, "validated");
  assert.equal(report.moderation_case_status, "VALIDATED");
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO trust_events") &&
        call.params[7] === "provider_report_validated"
    )
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[4] === "VALIDATED"
    )
  );
});

test("dismissed provider report closes case without trust penalty event", async () => {
  const client = createClient();

  const report = await dismissProviderReport({
    client,
    reportId: REPORT_ID,
    adminId: ADMIN_ID,
  });

  assert.equal(report.status, "dismissed");
  assert.equal(report.moderation_case_status, "DISMISSED");
  assert.equal(
    client.calls.some((call) => call.sql.includes("INSERT INTO trust_events")),
    false
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[4] === "DISMISSED"
    )
  );
});

test("moderation case detail includes linked report, attachments, and timeline", async () => {
  const client = createClient();

  const detail = await getModerationCaseDetail({ client, caseId: CASE_ID });

  assert.equal(detail.id, CASE_ID);
  assert.equal(detail.report.id, REPORT_ID);
  assert.equal(detail.report.attachments.length, 1);
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].event_type, "CASE_OPENED");
});
