const assert = require("node:assert/strict");
const test = require("node:test");

const {
  eventsToCsv,
  getAuditCenter,
  normalizeAuditFilters,
  sanitizeMetadata,
} = require("../shared/services/auditCenter.service");

function createClient() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const adminQuery = params.includes("admin");

      return {
        rows: [
          {
            domain: adminQuery ? "trust" : "moderation",
            event_time: "2026-06-07T10:00:00.000Z",
            actor_type: adminQuery ? "admin" : "ngo",
            actor_id: adminQuery
              ? "33333333-3333-4333-8333-333333333333"
              : "22222222-2222-4222-8222-222222222222",
            actor_label: adminQuery ? "Admin User" : "Helping NGO",
            action: adminQuery ? "TRUST_REVIEW_FLAG" : "PROVIDER_REPORT_SUBMITTED",
            target_type: "provider",
            target_id: "11111111-1111-4111-8111-111111111111",
            target_label: "Green Kitchen",
            event_type: adminQuery ? "TRUST_REVIEW_FLAG" : "PROVIDER_REPORT_SUBMITTED",
            details: "Audit trail row",
            source_table: adminQuery ? "admin_trust_actions" : "provider_reports",
            source_event_id: adminQuery ? "trust-event-key" : "report-1",
            source_record_id: adminQuery ? "action-1" : "report-1",
            event_identifier: adminQuery ? "trust-event-key" : "report-1",
            record_identifier: adminQuery
              ? "admin_trust_actions:action-1"
              : "provider_reports:report-1",
            source_rank: adminQuery ? 11 : 20,
            immutable: adminQuery,
            metadata: {
              case_id: "case-1",
              token: "hidden",
              idempotency_key: "idem-1",
              nested: {
                signature: "hidden",
                payload_hash: "hash-ok",
              },
            },
          },
        ],
      };
    },
  };
}

function hasMutation(calls) {
  return calls.some((call) =>
    /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(call.sql)
  );
}

test("audit center aggregates source rows without mutating audit records", async () => {
  const client = createClient();

  const audit = await getAuditCenter({
    client,
    domains: "moderation,trust",
    q: "case-1",
    limit: 25,
  });

  assert.equal(audit.informational_only, true);
  assert.equal(audit.enforcement_action, null);
  assert.equal(audit.events.length, 1);
  assert.equal(audit.recent_admin_actions.length, 1);
  assert.equal(audit.events[0].metadata.token, undefined);
  assert.equal(audit.events[0].metadata.idempotency_key, "idem-1");
  assert.equal(audit.events[0].metadata.nested.signature, undefined);
  assert.equal(audit.events[0].metadata.nested.payload_hash, "hash-ok");
  assert.ok(
    audit.source_inventory.some((source) => source.source.includes("trust_event_effects"))
  );
  assert.equal(hasMutation(client.calls), false);
});

test("audit center filters normalize domain and export bounds", () => {
  const filters = normalizeAuditFilters(
    {
      domains: "unknown,financial",
      actorType: "provider",
      actorId: "11111111-1111-4111-8111-111111111111",
      limit: 99999,
    },
    { exportMode: true }
  );

  assert.deepEqual(filters.domains, ["financial"]);
  assert.equal(filters.actorType, "provider");
  assert.equal(filters.actorId, "11111111-1111-4111-8111-111111111111");
  assert.equal(filters.limit, 5000);
});

test("audit center financial source exposes accounting classifications", async () => {
  const client = createClient();

  await getAuditCenter({
    client,
    domains: "financial",
    limit: 10,
  });

  assert.match(client.calls[0].sql, /financial_accounting_classifications/);
  assert.match(client.calls[0].sql, /accounting_category/);
  assert.match(client.calls[0].sql, /accounting_category_label/);
});

test("audit export CSV keeps lineage while removing sensitive metadata", () => {
  const metadata = sanitizeMetadata({
    idempotency_key: "idem-ok",
    refresh_token: "hidden",
    gateway_response: { raw: true },
    signature_present: true,
    payload_hash: "hash-ok",
  });

  const csv = eventsToCsv([
    {
      timestamp: "2026-06-07T10:00:00.000Z",
      domain: "financial",
      actor: { type: "system", id: null, label: null },
      action: "payment_collected",
      target: { type: "reservation", id: "reservation-1", label: null },
      event_type: "payment_collected",
      details: "Payment collected",
      source: {
        table: "financial_ledger_entries",
        event_identifier: "ledger-1",
        record_identifier: "financial_ledger_entries:ledger-1",
        immutable: true,
      },
      metadata,
    },
  ]);

  assert.match(csv, /financial_ledger_entries:ledger-1/);
  assert.match(csv, /idem-ok/);
  assert.match(csv, /payload_hash/);
  assert.doesNotMatch(csv, /refresh_token/);
  assert.doesNotMatch(csv, /gateway_response/);
});
