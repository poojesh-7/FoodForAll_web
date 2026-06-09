const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDeletionRequest,
  executeDeletionRequest,
  getComplianceDashboard,
  transitionDeletionRequest,
} = require("../shared/services/compliance.service");

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function hasMutation(calls) {
  return calls.some((call) =>
    /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(call.sql)
  );
}

function createDashboardClient() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("FROM retention_policies")) {
        return {
          rows: [
            {
              policy_key: "trust_replay_records",
              category: "trust",
              display_name: "Trust Replay Records",
              description: "Retained",
              deletion_eligible: false,
              deletion_mode: "never_delete",
              archive_mode: "searchable_hot",
              legal_basis: "trust_replay",
              immutable_source: true,
              searchable_when_archived: true,
              protects_financial_integrity: false,
              protects_trust_replay: true,
              protects_investigations: true,
              default_policy: true,
              metadata: {},
            },
          ],
        };
      }

      if (sql.includes("GROUP BY status")) {
        return { rows: [{ status: "REQUESTED", count: 2 }] };
      }

      if (sql.includes("FROM data_deletion_requests ddr")) {
        return {
          rows: [
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              request_type: "account_deletion",
              subject_type: "user",
              subject_id: USER_ID,
              target_user_id: USER_ID,
              requested_by_user_id: ADMIN_ID,
              requested_by_name: "Admin",
              target_user_name: "Target",
              status: "REQUESTED",
              reason: "User request",
              legal_hold: false,
              policy_key: "privacy_requests",
              approval_snapshot: {},
              execution_result: {},
              requested_at: "2026-06-08T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("WITH evidence AS")) {
        if (sql.includes("COUNT(*)::int AS total_assets")) {
          return {
            rows: [
              {
                total_assets: 3,
                archived_assets: 1,
                archive_candidates: 2,
                total_bytes: 4096,
              },
            ],
          };
        }
        return {
          rows: [
            {
              evidence_type: "provider_report_attachment",
              id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              file_url: "https://res.cloudinary.com/demo/image/upload/evidence.webp",
              mime_type: "image/webp",
              file_size_bytes: 4096,
              retention_policy_key: "evidence_records",
              archive_status: "active",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("FROM notifications") && sql.includes("total_notifications")) {
        return {
          rows: [
            {
              total_notifications: 10,
              active_notifications: 7,
              archived_notifications: 3,
              archive_candidates: 4,
              deletion_review_candidates: 1,
            },
          ],
        };
      }

      if (sql.includes("ledger_entries")) {
        return {
          rows: [
            {
              ledger_entries: 12,
              settlement_allocations: 4,
              provider_settlements: 4,
              settlement_batches: 1,
              refund_terminal_records: 2,
              webhook_audit_records: 9,
              payment_order_attempts: 8,
              reconciliation_records: 6,
            },
          ],
        };
      }

      if (sql.includes("trust_event_effects")) {
        return {
          rows: [
            {
              trust_events: 15,
              trust_event_effects: 15,
              trust_scores: 5,
              trust_restrictions: 1,
              replay_pending_events: 0,
            },
          ],
        };
      }

      if (sql.includes("operational_events") && sql.includes("compliance_events")) {
        return {
          rows: [
            {
              operational_events: 20,
              compliance_events: 2,
              incident_events: 5,
              financial_events: 12,
              trust_events: 15,
            },
          ],
        };
      }

      if (sql.includes("incident_records")) {
        return {
          rows: [
            {
              incident_records: 2,
              incident_events: 5,
              incident_notes: 3,
              incident_postmortems: 1,
              archive_candidates: 0,
            },
          ],
        };
      }

      if (sql.includes("FROM data_archive_records")) {
        return { rows: [{ policy_key: "evidence_records", archive_status: "archived", count: 1 }] };
      }

      if (sql.includes("FROM compliance_events") && sql.includes("GROUP BY event_type")) {
        return { rows: [{ event_type: "DELETION_REQUEST_CREATED", count: 1 }] };
      }

      if (sql.includes("FROM compliance_events ce")) {
        return {
          rows: [
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              event_type: "DELETION_REQUEST_CREATED",
              actor_type: "admin",
              target_type: "user",
              target_id: USER_ID,
              created_at: "2026-06-08T00:00:00.000Z",
            },
          ],
        };
      }

      return { rows: [] };
    },
  };
}

function createWorkflowClient() {
  const calls = [];
  const request = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    request_type: "account_deletion",
    subject_type: "user",
    subject_id: USER_ID,
    target_user_id: USER_ID,
    requested_by_user_id: ADMIN_ID,
    status: "REQUESTED",
    reason: "User privacy request",
    legal_hold: false,
    policy_key: "privacy_requests",
    approval_snapshot: {},
    execution_result: {},
    requested_at: "2026-06-08T00:00:00.000Z",
  };

  return {
    calls,
    request,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("SELECT id, role, is_verified")) {
        return { rows: [{ id: ADMIN_ID, role: "admin", is_verified: true }] };
      }

      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }

      if (sql.includes("AND status IN ('REQUESTED','UNDER_REVIEW','APPROVED')")) {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO data_deletion_requests")) {
        return { rows: [request] };
      }

      if (sql.includes("INSERT INTO compliance_events")) {
        return {
          rows: [
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              event_type: params[0],
              actor_user_id: params[1],
              target_type: params[3],
              target_id: params[4],
              deletion_request_id: params[5],
              policy_key: params[6],
              created_at: "2026-06-08T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("FROM data_deletion_requests ddr")) {
        return { rows: [request] };
      }

      if (sql.includes("FROM compliance_events ce")) {
        return { rows: [] };
      }

      if (sql.includes("financial_ledger_links")) {
        return {
          rows: [
            {
              financial_ledger_links: 1,
              provider_settlement_links: 1,
              payment_ownership_links: 1,
              trust_event_links: 2,
              trust_score_links: 1,
              provider_report_links: 1,
              appeal_links: 0,
              incident_event_links: 0,
              notification_links: 3,
              provider_evidence_links: 1,
              appeal_evidence_links: 0,
            },
          ],
        };
      }

      if (sql.includes("UPDATE data_deletion_requests") && sql.includes("approval_snapshot")) {
        request.status = params[1];
        request.approval_snapshot = JSON.parse(params[4]);
        return { rows: [request], rowCount: 1 };
      }

      if (sql.includes("UPDATE users")) {
        return { rows: [{ id: USER_ID, role: "user" }], rowCount: 1 };
      }

      if (sql.includes("UPDATE restaurants")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("UPDATE ngos")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("UPDATE notifications")) {
        return { rows: [{ id: "notification-1" }], rowCount: 3 };
      }

      if (sql.includes("UPDATE data_deletion_requests") && sql.includes("execution_result")) {
        request.status = "EXECUTED";
        request.execution_summary = params[1];
        request.execution_result = JSON.parse(params[2]);
        return { rows: [request], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

test("compliance dashboard reads retention state without mutating records", async () => {
  const client = createDashboardClient();

  const dashboard = await getComplianceDashboard({ client, limit: 20 });

  assert.equal(dashboard.informational_only, true);
  assert.equal(dashboard.enforcement_action, null);
  assert.equal(dashboard.retention_policies.length, 1);
  assert.equal(dashboard.summary.pending_deletion_requests, 2);
  assert.equal(dashboard.evidence_inventory.summary.total_assets, 3);
  assert.equal(dashboard.notification_retention_status.archive_candidates, 4);
  assert.equal(dashboard.financial_retention_status.deletion_allowed, false);
  assert.equal(dashboard.trust_retention_status.replay_required, true);
  assert.equal(hasMutation(client.calls), false);
});

test("compliance workflow anonymizes account data without deleting protected records", async () => {
  const client = createWorkflowClient();

  const created = await createDeletionRequest({
    client,
    adminId: ADMIN_ID,
    requestType: "account_deletion",
    subjectType: "user",
    subjectId: USER_ID,
    reason: "User privacy request",
  });
  assert.equal(created.request.status, "REQUESTED");

  const approved = await transitionDeletionRequest({
    client,
    requestId: client.request.id,
    adminId: ADMIN_ID,
    status: "APPROVED",
    note: "Approved after review",
  });
  assert.equal(approved.request.status, "APPROVED");
  assert.equal(approved.request.approval_snapshot.trust_replay_required, true);

  const executed = await executeDeletionRequest({
    client,
    requestId: client.request.id,
    adminId: ADMIN_ID,
    note: "Anonymized contact data",
  });
  assert.equal(executed.request.status, "EXECUTED");
  assert.equal(executed.request.execution_result.mode, "anonymization");
  assert.equal(executed.request.execution_result.preserved.includes("financial_records"), true);
  assert.equal(
    client.calls.some((call) => /^\s*DELETE\b/i.test(call.sql)),
    false
  );
  assert.equal(
    client.calls.some((call) => /UPDATE\s+users/i.test(call.sql)),
    true
  );
});
