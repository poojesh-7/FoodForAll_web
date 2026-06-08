const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createIncident,
  transitionIncidentStatus,
} = require("../shared/services/incidentManagement.service");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";

function createFakeClient({ status = "OPEN" } = {}) {
  const calls = [];
  const eventInserts = [];
  const incident = {
    id: INCIDENT_ID,
    title: "Notification outage",
    description: "Push notifications are delayed",
    severity: "SEV2",
    category: "NOTIFICATIONS",
    initial_status: "OPEN",
    created_by_admin_id: ADMIN_ID,
    created_by_admin_name: "Admin",
    assigned_admin_id: null,
    assigned_admin_name: null,
    resolved_by_admin_id: null,
    resolved_by_admin_name: null,
    closed_by_admin_id: null,
    closed_by_admin_name: null,
    source_type: "operational_alert",
    source_ref_id: "notification-queue-failed",
    source_context: { alert_key: "notification-queue-failed" },
    created_at: "2026-06-07T10:00:00.000Z",
    resolved_at: null,
    closed_at: null,
    note_count: 0,
    postmortem_id: null,
    postmortem_created_at: null,
    status,
  };

  return {
    calls,
    eventInserts,
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

      if (sql.includes("INSERT INTO incident_records")) {
        return { rows: [{ ...incident, title: params[0], status: "OPEN" }] };
      }

      if (sql.includes("INSERT INTO incident_events")) {
        eventInserts.push({ sql, params });
        return { rows: [{ id: `event-${eventInserts.length}` }] };
      }

      if (sql.includes("FROM incident_state")) {
        return { rows: [incident] };
      }

      if (sql.includes("FROM incident_events ie")) {
        return {
          rows: eventInserts.map((event, index) => ({
            id: `event-${index + 1}`,
            incident_id: INCIDENT_ID,
            actor_user_id: ADMIN_ID,
            actor_name: "Admin",
            actor_role: "admin",
            event_type: event.params[2] || "INCIDENT_CREATED",
            from_status: event.params[3] || null,
            to_status: event.params[4] || null,
            from_assigned_admin_id: null,
            from_assigned_admin_name: null,
            to_assigned_admin_id: null,
            to_assigned_admin_name: null,
            note_id: null,
            postmortem_id: null,
            details: event.params[5] || null,
            metadata: {},
            created_at: "2026-06-07T10:00:00.000Z",
          })),
        };
      }

      if (sql.includes("FROM incident_notes")) {
        return { rows: [] };
      }

      if (sql.includes("FROM incident_postmortems")) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

test("incident creation records response context without operational remediation", async () => {
  const client = createFakeClient();
  const detail = await createIncident({
    client,
    adminId: ADMIN_ID,
    title: "Notification outage",
    description: "Push notifications are delayed",
    severity: "SEV2",
    category: "NOTIFICATIONS",
    sourceType: "operational_alert",
    sourceRefId: "notification-queue-failed",
    sourceContext: { alert_key: "notification-queue-failed" },
  });

  assert.equal(detail.incident.id, INCIDENT_ID);
  assert.equal(detail.incident.status, "OPEN");
  assert.equal(client.eventInserts.length, 1);
  assert.match(client.eventInserts[0].sql, /INCIDENT_CREATED/);
  assert.equal(
    client.calls.some(({ sql }) => /\bUPDATE\b|\bDELETE\b/.test(sql)),
    false
  );
});

test("incident status transitions reject invalid lifecycle jumps", async () => {
  const client = createFakeClient({ status: "OPEN" });

  await assert.rejects(
    () =>
      transitionIncidentStatus({
        client,
        incidentId: INCIDENT_ID,
        adminId: ADMIN_ID,
        status: "CLOSED",
      }),
    (err) => err.statusCode === 409
  );

  assert.equal(client.eventInserts.length, 0);
});

test("incident status transitions append immutable events for valid moves", async () => {
  const client = createFakeClient({ status: "OPEN" });

  const detail = await transitionIncidentStatus({
    client,
    incidentId: INCIDENT_ID,
    adminId: ADMIN_ID,
    status: "INVESTIGATING",
    note: "Initial triage started",
  });

  assert.equal(detail.incident.id, INCIDENT_ID);
  assert.equal(client.eventInserts.length, 1);
  assert.equal(client.eventInserts[0].params[2], "INCIDENT_STATUS_CHANGED");
  assert.equal(client.eventInserts[0].params[3], "OPEN");
  assert.equal(client.eventInserts[0].params[4], "INVESTIGATING");
});
