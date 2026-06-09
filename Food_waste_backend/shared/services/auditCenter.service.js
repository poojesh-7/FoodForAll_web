const pool = require("../config/db");

const AUDIT_DOMAINS = [
  "trust",
  "moderation",
  "appeals",
  "verification",
  "governance",
  "incidents",
  "financial",
  "notifications",
  "compliance",
];

const ACTOR_TYPES = ["user", "provider", "ngo", "volunteer", "admin", "system", "gateway"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_EXPORT_LIMIT = 5000;

const SOURCE_INVENTORY = [
  {
    domain: "trust",
    source: "trust_events",
    reuse: "Primary immutable trust timeline event stream.",
    status: "reused",
  },
  {
    domain: "trust",
    source: "trust_event_effects",
    reuse: "Supporting lineage for trust_events; summarized to avoid duplicate timeline rows.",
    status: "supporting",
  },
  {
    domain: "trust",
    source: "admin_trust_actions",
    reuse: "Immutable admin trust action ledger.",
    status: "reused",
  },
  {
    domain: "moderation",
    source: "provider_reports, provider_report_attachments",
    reuse: "Provider report submission and supporting evidence records.",
    status: "reused",
  },
  {
    domain: "moderation",
    source: "moderation_cases, moderation_case_events",
    reuse: "Moderation case lifecycle and event history.",
    status: "reused",
  },
  {
    domain: "appeals",
    source: "moderation_appeals, moderation_appeal_events",
    reuse: "Appeal submission and decision lifecycle.",
    status: "reused",
  },
  {
    domain: "verification",
    source: "operational_events",
    reuse: "Admin NGO/provider approval and rejection events emitted by existing verification controllers.",
    status: "reused",
  },
  {
    domain: "governance",
    source: "governanceIntelligence.service, governanceDashboard.service",
    reuse: "Derived read models for intelligence, governance dashboard, and business metrics export audit events.",
    status: "derived",
  },
  {
    domain: "incidents",
    source: "incident_records, incident_events, incident_notes, incident_postmortems",
    reuse: "Incident response lifecycle records and append-only event history.",
    status: "reused",
  },
  {
    domain: "financial",
    source: "financial_ledger_entries, provider_settlements, settlement_batches, financial_state_transitions",
    reuse: "Ledger, settlement, refund, webhook audit, and reconciliation event sources.",
    status: "reused",
  },
  {
    domain: "notifications",
    source: "notifications",
    reuse: "Notification creation/read-state records. Delivery attempts are represented by queue/worker observability, not a dedicated delivery table.",
    status: "partial",
  },
  {
    domain: "compliance",
    source: "compliance_events, data_deletion_requests",
    reuse: "Immutable compliance event ledger and controlled privacy/deletion workflow records.",
    status: "reused",
  },
];

const ANALYSIS = {
  architecture: [
    "Audit Center is a read-only aggregate over existing owning tables.",
    "No trust formulas, moderation transitions, appeal transitions, or financial flows are changed.",
    "Timeline pagination uses a stable keyset cursor over timestamp, source rank, and source record id.",
    "Exports reuse the same read model and sanitize metadata fields that can contain secrets or raw gateway payloads.",
    "Incident response lifecycle events are included as operational audit records and do not mutate monitored systems.",
    "Compliance actions are included through immutable compliance_events and link back to data_deletion_requests.",
  ],
  gaps: [
    "Governance intelligence signals are derived read-model outputs, not persisted immutable audit records.",
    "Notification delivery attempts do not have a dedicated delivery-record table in the current schema.",
    "Verification actions are traceable through operational_events rather than dedicated verification action tables.",
    "Incident source context stores referenced monitoring/diagnostic snapshots rather than owning those source systems.",
    "Compliance physical deletion is intentionally absent; current execution paths anonymize or archive while preserving protected records.",
  ],
  reuse: [
    "Trust: trust_events plus admin_trust_actions; trust_event_effects is summarized as supporting lineage.",
    "Moderation and appeals: existing event tables remain the authoritative source of lifecycle changes.",
    "Incidents: incident_events is the authoritative response timeline, with incident_records, notes, and postmortems as supporting records.",
    "Financial: immutable ledger, settlement snapshots, terminal refund records, webhook audit log, and state transitions are reused directly.",
    "Governance: dashboard/intelligence/business metrics services remain informational-only and are referenced as derived sources.",
    "Compliance: compliance_events is the immutable source for retention policy, privacy, deletion, and archival actions.",
  ],
  risks: [
    "Cross-domain correlation can render the same underlying business activity more than once; source_table and event_identifier make duplicates explainable.",
    "Large exports can stress the database if unbounded; export limits are capped and use the same filters as the timeline.",
    "Free-text search across a union read model is useful for investigations but should not replace source-specific indexed lookups for very large forensic jobs.",
    "Operational_events currently has no immutability trigger, so verification lineage is visible but not as strongly protected as trust/financial ledgers.",
    "Incident duplication is possible by design; source references and search make duplicates explainable without blocking legitimate response tracks.",
    "Compliance requests can contain sensitive context, so metadata sanitization is applied before export.",
  ],
  schemaChanges: [
    "Migration 022 adds audit timeline indexes only; it creates no new mutable audit record table.",
    "Migration 023 adds immutable incident management tables for T7.3.",
    "Migration 025 adds retention policies, deletion request workflow records, archive records, and immutable compliance_events.",
  ],
};

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeList(item));
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeCursor(cursor) {
  if (!cursor) return null;

  try {
    const decoded = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (!decoded?.eventTime || !decoded?.sourceRecordId) return null;
    return {
      eventTime: decoded.eventTime,
      sourceRank: toInt(decoded.sourceRank, 0),
      sourceRecordId: String(decoded.sourceRecordId),
    };
  } catch {
    return null;
  }
}

function encodeCursor(row) {
  if (!row) return null;
  return Buffer.from(
    JSON.stringify({
      eventTime: row.event_time,
      sourceRank: row.source_rank,
      sourceRecordId: row.source_record_id,
    })
  ).toString("base64url");
}

function normalizeAuditFilters(options = {}, config = {}) {
  const requestedDomains = normalizeList(options.domains || options.domain);
  const domains =
    requestedDomains.length === 0 || requestedDomains.includes("all")
      ? AUDIT_DOMAINS
      : requestedDomains.filter((domain) => AUDIT_DOMAINS.includes(domain));

  const requestedActorType = String(options.actorType || options.actor_type || "")
    .trim()
    .toLowerCase();
  const actorType = ACTOR_TYPES.includes(requestedActorType) ? requestedActorType : null;
  const actorId = String(options.actorId || options.actor_id || "")
    .trim()
    .slice(0, 160);
  const search = String(options.q || options.search || "")
    .trim()
    .slice(0, 160);
  const maxLimit = config.exportMode ? MAX_EXPORT_LIMIT : MAX_LIMIT;
  const defaultLimit = config.exportMode ? 1000 : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(toInt(options.limit, defaultLimit), maxLimit));

  return {
    domains: domains.length ? domains : AUDIT_DOMAINS,
    actorType,
    actorId: actorId || null,
    search: search || null,
    startAt: parseDate(options.startAt || options.start_at),
    endAt: parseDate(options.endAt || options.end_at),
    cursor: decodeCursor(options.cursor),
    rawCursor: options.cursor || null,
    limit,
  };
}

function publicFilters(filters) {
  return {
    domains: filters.domains,
    actor_type: filters.actorType,
    actor_id: filters.actorId,
    q: filters.search,
    start_at: filters.startAt,
    end_at: filters.endAt,
    limit: filters.limit,
    cursor: filters.rawCursor || null,
  };
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function trustEventsSource() {
  return `
    SELECT
      'trust'::text AS domain,
      te.created_at::timestamptz AS event_time,
      COALESCE(subject_user.role, te.subject_type)::text AS actor_type,
      te.subject_id::text AS actor_id,
      subject_user.name::text AS actor_label,
      te.event_type::text AS action,
      te.subject_type::text AS target_type,
      te.subject_id::text AS target_id,
      COALESCE(subject_user.name, te.subject_id::text)::text AS target_label,
      te.event_type::text AS event_type,
      CONCAT('Trust event ', te.event_type, ' for ', te.subject_type)::text AS details,
      'trust_events'::text AS source_table,
      te.event_key::text AS source_event_id,
      te.id::text AS source_record_id,
      te.event_key::text AS event_identifier,
      CONCAT('trust_events:', te.id::text)::text AS record_identifier,
      10::int AS source_rank,
      true::boolean AS immutable,
      (
        jsonb_build_object(
          'event_key', te.event_key,
          'source_type', te.source_type,
          'source_id', te.source_id,
          'subject_type', te.subject_type,
          'subject_id', te.subject_id,
          'reservation_id', te.reservation_id,
          'payment_id', te.payment_id,
          'processing_status', te.processing_status,
          'attempt_count', te.attempt_count,
          'processed_at', te.processed_at,
          'effect_count', COALESCE(effect_counts.effect_count, 0)
        ) || COALESCE(te.event_payload, '{}'::jsonb)
      ) AS metadata,
      CONCAT_WS(' ', te.id, te.event_key, te.subject_type, te.subject_id, te.source_type, te.source_id, te.event_type, te.reservation_id, te.payment_id)::text AS search_text
    FROM trust_events te
    LEFT JOIN users subject_user ON subject_user.id = te.subject_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS effect_count
      FROM trust_event_effects tee
      WHERE tee.event_id = te.id
    ) effect_counts ON true
  `;
}

function adminTrustActionsSource() {
  return `
    SELECT
      'trust'::text AS domain,
      ata.created_at::timestamptz AS event_time,
      'admin'::text AS actor_type,
      ata.admin_user_id::text AS actor_id,
      admin_user.name::text AS actor_label,
      ata.action_type::text AS action,
      ata.subject_type::text AS target_type,
      ata.subject_id::text AS target_id,
      COALESCE(subject_user.name, ata.subject_id::text)::text AS target_label,
      ata.action_type::text AS event_type,
      ata.reason::text AS details,
      'admin_trust_actions'::text AS source_table,
      ata.trust_event_key::text AS source_event_id,
      ata.id::text AS source_record_id,
      ata.trust_event_key::text AS event_identifier,
      CONCAT('admin_trust_actions:', ata.id::text)::text AS record_identifier,
      11::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'admin_user_id', ata.admin_user_id,
        'subject_type', ata.subject_type,
        'subject_id', ata.subject_id,
        'trust_event_key', ata.trust_event_key,
        'idempotency_key', ata.idempotency_key,
        'details', ata.details
      ) AS metadata,
      CONCAT_WS(' ', ata.id, ata.trust_event_key, ata.admin_user_id, ata.subject_type, ata.subject_id, ata.action_type, ata.reason)::text AS search_text
    FROM admin_trust_actions ata
    LEFT JOIN users admin_user ON admin_user.id = ata.admin_user_id
    LEFT JOIN users subject_user ON subject_user.id = ata.subject_id
  `;
}

function providerReportsSource() {
  return `
    SELECT
      'moderation'::text AS domain,
      pr.created_at::timestamptz AS event_time,
      COALESCE(reporter.role, 'user')::text AS actor_type,
      pr.reported_by::text AS actor_id,
      reporter.name::text AS actor_label,
      CONCAT('provider_report_', pr.status)::text AS action,
      'provider'::text AS target_type,
      pr.provider_id::text AS target_id,
      COALESCE(provider.name, pr.provider_id::text)::text AS target_label,
      'PROVIDER_REPORT_SUBMITTED'::text AS event_type,
      CONCAT_WS(' | ', pr.reason, pr.description)::text AS details,
      'provider_reports'::text AS source_table,
      pr.id::text AS source_event_id,
      pr.id::text AS source_record_id,
      pr.id::text AS event_identifier,
      CONCAT('provider_reports:', pr.id::text)::text AS record_identifier,
      20::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'report_id', pr.id,
        'provider_id', pr.provider_id,
        'reported_by', pr.reported_by,
        'reservation_id', pr.reservation_id,
        'moderation_case_id', pr.moderation_case_id,
        'status', pr.status,
        'resolved_at', pr.resolved_at,
        'reviewed_by_admin', pr.reviewed_by_admin
      ) AS metadata,
      CONCAT_WS(' ', pr.id, pr.provider_id, pr.reported_by, pr.reservation_id, pr.moderation_case_id, pr.reason, pr.description, pr.status)::text AS search_text
    FROM provider_reports pr
    LEFT JOIN users reporter ON reporter.id = pr.reported_by
    LEFT JOIN users provider ON provider.id = pr.provider_id
  `;
}

function providerReportAttachmentsSource() {
  return `
    SELECT
      'moderation'::text AS domain,
      pra.created_at::timestamptz AS event_time,
      COALESCE(uploader.role, 'user')::text AS actor_type,
      pra.uploader_user_id::text AS actor_id,
      uploader.name::text AS actor_label,
      'provider_report_attachment_uploaded'::text AS action,
      'provider_report'::text AS target_type,
      pra.report_id::text AS target_id,
      pra.report_id::text AS target_label,
      'PROVIDER_REPORT_ATTACHMENT_UPLOADED'::text AS event_type,
      CONCAT('Attachment uploaded: ', pra.mime_type, ' ', pra.file_size_bytes, ' bytes')::text AS details,
      'provider_report_attachments'::text AS source_table,
      pra.id::text AS source_event_id,
      pra.id::text AS source_record_id,
      pra.id::text AS event_identifier,
      CONCAT('provider_report_attachments:', pra.id::text)::text AS record_identifier,
      21::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'attachment_id', pra.id,
        'report_id', pra.report_id,
        'uploader_user_id', pra.uploader_user_id,
        'mime_type', pra.mime_type,
        'file_size_bytes', pra.file_size_bytes
      ) AS metadata,
      CONCAT_WS(' ', pra.id, pra.report_id, pra.uploader_user_id, pra.mime_type)::text AS search_text
    FROM provider_report_attachments pra
    LEFT JOIN users uploader ON uploader.id = pra.uploader_user_id
  `;
}

function moderationCasesSource() {
  return `
    SELECT
      'moderation'::text AS domain,
      mc.created_at::timestamptz AS event_time,
      COALESCE(opener.role, 'system')::text AS actor_type,
      mc.opened_by_user_id::text AS actor_id,
      opener.name::text AS actor_label,
      'moderation_case_opened'::text AS action,
      mc.subject_type::text AS target_type,
      mc.subject_id::text AS target_id,
      COALESCE(subject_user.name, mc.subject_id::text)::text AS target_label,
      'CASE_OPENED'::text AS event_type,
      CONCAT_WS(' | ', mc.reason, mc.summary)::text AS details,
      'moderation_cases'::text AS source_table,
      mc.id::text AS source_event_id,
      mc.id::text AS source_record_id,
      mc.id::text AS event_identifier,
      CONCAT('moderation_cases:', mc.id::text)::text AS record_identifier,
      22::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'case_id', mc.id,
        'case_type', mc.case_type,
        'status', mc.status,
        'source_report_id', mc.source_report_id,
        'assigned_admin_id', mc.assigned_admin_id,
        'closed_at', mc.closed_at
      ) AS metadata,
      CONCAT_WS(' ', mc.id, mc.case_type, mc.subject_type, mc.subject_id, mc.status, mc.source_report_id, mc.reason, mc.summary)::text AS search_text
    FROM moderation_cases mc
    LEFT JOIN users opener ON opener.id = mc.opened_by_user_id
    LEFT JOIN users subject_user ON subject_user.id = mc.subject_id
  `;
}

function moderationCaseEventsSource() {
  return `
    SELECT
      'moderation'::text AS domain,
      mce.created_at::timestamptz AS event_time,
      COALESCE(actor.role, 'system')::text AS actor_type,
      mce.actor_user_id::text AS actor_id,
      actor.name::text AS actor_label,
      mce.event_type::text AS action,
      mc.subject_type::text AS target_type,
      mc.subject_id::text AS target_id,
      COALESCE(subject_user.name, mc.subject_id::text)::text AS target_label,
      mce.event_type::text AS event_type,
      CONCAT_WS(' | ', mce.from_status, mce.to_status, mce.note)::text AS details,
      'moderation_case_events'::text AS source_table,
      mce.id::text AS source_event_id,
      mce.id::text AS source_record_id,
      mce.id::text AS event_identifier,
      CONCAT('moderation_case_events:', mce.id::text)::text AS record_identifier,
      23::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'case_id', mce.case_id,
        'actor_user_id', mce.actor_user_id,
        'from_status', mce.from_status,
        'to_status', mce.to_status,
        'note', mce.note,
        'metadata', mce.metadata
      ) AS metadata,
      CONCAT_WS(' ', mce.id, mce.case_id, mce.actor_user_id, mce.event_type, mce.from_status, mce.to_status, mce.note, mc.subject_id)::text AS search_text
    FROM moderation_case_events mce
    JOIN moderation_cases mc ON mc.id = mce.case_id
    LEFT JOIN users actor ON actor.id = mce.actor_user_id
    LEFT JOIN users subject_user ON subject_user.id = mc.subject_id
  `;
}

function moderationAppealsSource() {
  return `
    SELECT
      'appeals'::text AS domain,
      ma.submitted_at::timestamptz AS event_time,
      COALESCE(provider.role, 'provider')::text AS actor_type,
      ma.provider_id::text AS actor_id,
      provider.name::text AS actor_label,
      'moderation_appeal_submitted'::text AS action,
      'moderation_case'::text AS target_type,
      ma.case_id::text AS target_id,
      ma.case_id::text AS target_label,
      'APPEAL_SUBMITTED'::text AS event_type,
      ma.appeal_text::text AS details,
      'moderation_appeals'::text AS source_table,
      ma.id::text AS source_event_id,
      ma.id::text AS source_record_id,
      ma.id::text AS event_identifier,
      CONCAT('moderation_appeals:', ma.id::text)::text AS record_identifier,
      30::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'appeal_id', ma.id,
        'case_id', ma.case_id,
        'provider_id', ma.provider_id,
        'status', ma.status,
        'reviewed_by_admin', ma.reviewed_by_admin,
        'reviewed_at', ma.reviewed_at,
        'withdrawn_at', ma.withdrawn_at,
        'withdrawn_by_user_id', ma.withdrawn_by_user_id
      ) AS metadata,
      CONCAT_WS(' ', ma.id, ma.case_id, ma.provider_id, ma.status, ma.appeal_text, ma.decision_note)::text AS search_text
    FROM moderation_appeals ma
    LEFT JOIN users provider ON provider.id = ma.provider_id
  `;
}

function moderationAppealEventsSource() {
  return `
    SELECT
      'appeals'::text AS domain,
      mae.created_at::timestamptz AS event_time,
      COALESCE(actor.role, 'system')::text AS actor_type,
      mae.actor_user_id::text AS actor_id,
      actor.name::text AS actor_label,
      mae.event_type::text AS action,
      'moderation_appeal'::text AS target_type,
      mae.appeal_id::text AS target_id,
      mae.appeal_id::text AS target_label,
      mae.event_type::text AS event_type,
      CONCAT_WS(' | ', mae.from_status, mae.to_status, mae.note)::text AS details,
      'moderation_appeal_events'::text AS source_table,
      mae.id::text AS source_event_id,
      mae.id::text AS source_record_id,
      mae.id::text AS event_identifier,
      CONCAT('moderation_appeal_events:', mae.id::text)::text AS record_identifier,
      31::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'appeal_id', mae.appeal_id,
        'case_id', mae.case_id,
        'actor_user_id', mae.actor_user_id,
        'from_status', mae.from_status,
        'to_status', mae.to_status,
        'note', mae.note,
        'metadata', mae.metadata
      ) AS metadata,
      CONCAT_WS(' ', mae.id, mae.appeal_id, mae.case_id, mae.actor_user_id, mae.event_type, mae.from_status, mae.to_status, mae.note)::text AS search_text
    FROM moderation_appeal_events mae
    LEFT JOIN users actor ON actor.id = mae.actor_user_id
  `;
}

function verificationOperationalEventsSource() {
  return `
    SELECT
      'verification'::text AS domain,
      oe.created_at::timestamptz AS event_time,
      'admin'::text AS actor_type,
      COALESCE(oe.metadata->>'adminId', oe.user_id::text)::text AS actor_id,
      NULL::text AS actor_label,
      oe.event_name::text AS action,
      CASE
        WHEN oe.event_name LIKE '%ngo%' THEN 'ngo'
        WHEN oe.event_name LIKE '%restaurant%' THEN 'provider'
        ELSE 'verification_record'
      END::text AS target_type,
      COALESCE(oe.metadata->>'ngoId', oe.metadata->>'restaurantId', oe.metadata->>'userId', oe.reservation_id::text)::text AS target_id,
      COALESCE(oe.metadata->>'ngoId', oe.metadata->>'restaurantId', oe.metadata->>'userId')::text AS target_label,
      oe.event_name::text AS event_type,
      CONCAT('Verification action: ', oe.event_name)::text AS details,
      'operational_events'::text AS source_table,
      oe.id::text AS source_event_id,
      oe.id::text AS source_record_id,
      oe.id::text AS event_identifier,
      CONCAT('operational_events:', oe.id::text)::text AS record_identifier,
      40::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'category', oe.category,
        'severity', oe.severity,
        'event_name', oe.event_name,
        'request_id', oe.request_id,
        'metadata', oe.metadata
      ) AS metadata,
      CONCAT_WS(' ', oe.id, oe.event_name, oe.user_id, oe.role, oe.request_id, oe.metadata)::text AS search_text
    FROM operational_events oe
    WHERE oe.event_name IN (
      'admin_approved_ngo',
      'admin_rejected_ngo',
      'admin_approved_restaurant',
      'admin_rejected_restaurant'
    )
  `;
}

function governanceOperationalEventsSource() {
  return `
    SELECT
      'governance'::text AS domain,
      oe.created_at::timestamptz AS event_time,
      COALESCE(oe.role, 'system')::text AS actor_type,
      oe.user_id::text AS actor_id,
      actor.name::text AS actor_label,
      oe.event_name::text AS action,
      COALESCE(oe.metadata->>'actor_type', 'governance')::text AS target_type,
      COALESCE(oe.metadata->>'actor_id', oe.metadata->>'providerId', oe.metadata->>'reporterId')::text AS target_id,
      COALESCE(oe.metadata->>'actor_name', oe.metadata->>'providerName', oe.metadata->>'reporterName')::text AS target_label,
      oe.event_name::text AS event_type,
      CONCAT('Governance operational event: ', oe.event_name)::text AS details,
      'operational_events'::text AS source_table,
      oe.id::text AS source_event_id,
      oe.id::text AS source_record_id,
      oe.id::text AS event_identifier,
      CONCAT('operational_events:', oe.id::text)::text AS record_identifier,
      50::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'category', oe.category,
        'severity', oe.severity,
        'event_name', oe.event_name,
        'request_id', oe.request_id,
        'metadata', oe.metadata,
        'derived_sources', ARRAY['governanceIntelligence.service','governanceDashboard.service','businessMetrics.service']
      ) AS metadata,
      CONCAT_WS(' ', oe.id, oe.category, oe.event_name, oe.user_id, oe.role, oe.request_id, oe.metadata)::text AS search_text
    FROM operational_events oe
    LEFT JOIN users actor ON actor.id = oe.user_id
    WHERE oe.category = 'governance'
       OR oe.event_name LIKE 'governance_%'
       OR oe.event_name LIKE 'business_metrics_%'
  `;
}

function incidentEventsSource() {
  return `
    SELECT
      'incidents'::text AS domain,
      ie.created_at::timestamptz AS event_time,
      'admin'::text AS actor_type,
      ie.actor_user_id::text AS actor_id,
      actor.name::text AS actor_label,
      ie.event_type::text AS action,
      'incident'::text AS target_type,
      ir.id::text AS target_id,
      ir.title::text AS target_label,
      ie.event_type::text AS event_type,
      COALESCE(ie.details, CONCAT('Incident ', LOWER(REPLACE(ie.event_type, '_', ' '))))::text AS details,
      'incident_events'::text AS source_table,
      ie.id::text AS source_event_id,
      ie.id::text AS source_record_id,
      ie.id::text AS event_identifier,
      CONCAT('incident_events:', ie.id::text)::text AS record_identifier,
      65::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'incident_id', ie.incident_id,
        'title', ir.title,
        'severity', ir.severity,
        'category', ir.category,
        'source_type', ir.source_type,
        'source_ref_id', ir.source_ref_id,
        'from_status', ie.from_status,
        'to_status', ie.to_status,
        'from_assigned_admin_id', ie.from_assigned_admin_id,
        'to_assigned_admin_id', ie.to_assigned_admin_id,
        'note_id', ie.note_id,
        'postmortem_id', ie.postmortem_id,
        'metadata', ie.metadata
      ) AS metadata,
      CONCAT_WS(' ', ie.id, ie.incident_id, ir.title, ir.severity, ir.category, ir.source_type, ir.source_ref_id, ie.event_type, ie.from_status, ie.to_status, ie.details)::text AS search_text
    FROM incident_events ie
    JOIN incident_records ir ON ir.id = ie.incident_id
    LEFT JOIN users actor ON actor.id = ie.actor_user_id
  `;
}

function notificationsSource() {
  return `
    SELECT
      'notifications'::text AS domain,
      n.created_at::timestamptz AS event_time,
      'system'::text AS actor_type,
      NULL::text AS actor_id,
      NULL::text AS actor_label,
      COALESCE(n.type, 'notification_created')::text AS action,
      COALESCE(recipient.role, 'user')::text AS target_type,
      n.user_id::text AS target_id,
      COALESCE(recipient.name, n.user_id::text)::text AS target_label,
      COALESCE(n.type, 'notification_created')::text AS event_type,
      CONCAT_WS(' | ', n.title, n.message)::text AS details,
      'notifications'::text AS source_table,
      n.id::text AS source_event_id,
      n.id::text AS source_record_id,
      n.id::text AS event_identifier,
      CONCAT('notifications:', n.id::text)::text AS record_identifier,
      60::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'notification_id', n.id,
        'user_id', n.user_id,
        'type', n.type,
        'title', n.title,
        'is_read', n.is_read,
        'listing_id', n.listing_id
      ) AS metadata,
      CONCAT_WS(' ', n.id, n.user_id, n.type, n.title, n.message, n.listing_id)::text AS search_text
    FROM notifications n
    LEFT JOIN users recipient ON recipient.id = n.user_id
  `;
}

function complianceEventsSource() {
  return `
    SELECT
      'compliance'::text AS domain,
      ce.created_at::timestamptz AS event_time,
      ce.actor_type::text AS actor_type,
      ce.actor_user_id::text AS actor_id,
      actor.name::text AS actor_label,
      ce.event_type::text AS action,
      ce.target_type::text AS target_type,
      ce.target_id::text AS target_id,
      COALESCE(target_user.name, ce.target_id)::text AS target_label,
      ce.event_type::text AS event_type,
      ce.details::text AS details,
      'compliance_events'::text AS source_table,
      ce.id::text AS source_event_id,
      ce.id::text AS source_record_id,
      ce.id::text AS event_identifier,
      CONCAT('compliance_events:', ce.id::text)::text AS record_identifier,
      66::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'event_id', ce.id,
        'deletion_request_id', ce.deletion_request_id,
        'policy_key', ce.policy_key,
        'target_type', ce.target_type,
        'target_id', ce.target_id,
        'metadata', ce.metadata,
        'request_status', ddr.status,
        'request_type', ddr.request_type,
        'subject_type', ddr.subject_type,
        'subject_id', ddr.subject_id
      ) AS metadata,
      CONCAT_WS(' ', ce.id, ce.event_type, ce.actor_user_id, ce.target_type, ce.target_id, ce.deletion_request_id, ce.policy_key, ce.details, ce.metadata)::text AS search_text
    FROM compliance_events ce
    LEFT JOIN users actor ON actor.id = ce.actor_user_id
    LEFT JOIN data_deletion_requests ddr ON ddr.id = ce.deletion_request_id
    LEFT JOIN users target_user ON target_user.id::text = ce.target_id
  `;
}

function financialLedgerSource() {
  return `
    SELECT
      'financial'::text AS domain,
      fle.created_at::timestamptz AS event_time,
      COALESCE(fle.actor_role, actor.role, 'system')::text AS actor_type,
      fle.actor_user_id::text AS actor_id,
      actor.name::text AS actor_label,
      fle.event_type::text AS action,
      'reservation'::text AS target_type,
      fle.reservation_id::text AS target_id,
      fle.reservation_id::text AS target_label,
      fle.event_type::text AS event_type,
      CONCAT(fle.event_type, ' ', fle.amount, ' ', fle.currency)::text AS details,
      'financial_ledger_entries'::text AS source_table,
      fle.id::text AS source_event_id,
      fle.id::text AS source_record_id,
      fle.id::text AS event_identifier,
      CONCAT('financial_ledger_entries:', fle.id::text)::text AS record_identifier,
      70::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'reservation_id', fle.reservation_id,
        'payment_id', fle.payment_id,
        'payment_session_id', fle.payment_session_id,
        'payment_ownership_id', fle.payment_ownership_id,
        'settlement_allocation_id', fle.settlement_allocation_id,
        'provider_settlement_id', fle.provider_settlement_id,
        'settlement_batch_id', fle.settlement_batch_id,
        'amount', fle.amount,
        'currency', fle.currency,
        'counterparty_user_id', fle.counterparty_user_id,
        'counterparty_role', fle.counterparty_role,
        'refund_id', fle.refund_id,
        'source_type', fle.source_type,
        'source_id', fle.source_id,
        'idempotency_key', fle.idempotency_key,
        'metadata', fle.metadata
      ) AS metadata,
      CONCAT_WS(' ', fle.id, fle.reservation_id, fle.payment_id, fle.payment_session_id, fle.provider_settlement_id, fle.settlement_batch_id, fle.event_type, fle.refund_id, fle.source_type, fle.source_id, fle.idempotency_key)::text AS search_text
    FROM financial_ledger_entries fle
    LEFT JOIN users actor ON actor.id = fle.actor_user_id
  `;
}

function settlementAllocationsSource() {
  return `
    SELECT
      'financial'::text AS domain,
      sas.created_at::timestamptz AS event_time,
      'system'::text AS actor_type,
      NULL::text AS actor_id,
      NULL::text AS actor_label,
      'settlement_allocation_snapshotted'::text AS action,
      'reservation'::text AS target_type,
      sas.reservation_id::text AS target_id,
      sas.reservation_id::text AS target_label,
      'SETTLEMENT_ALLOCATION_SNAPSHOTTED'::text AS event_type,
      CONCAT('Settlement allocation ', sas.provider_amount, ' ', sas.currency)::text AS details,
      'settlement_allocation_snapshots'::text AS source_table,
      sas.id::text AS source_event_id,
      sas.id::text AS source_record_id,
      sas.id::text AS event_identifier,
      CONCAT('settlement_allocation_snapshots:', sas.id::text)::text AS record_identifier,
      71::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'reservation_id', sas.reservation_id,
        'payment_id', sas.payment_id,
        'payment_session_id', sas.payment_session_id,
        'payment_ownership_id', sas.payment_ownership_id,
        'commission_percent', sas.commission_percent,
        'commission_amount', sas.commission_amount,
        'provider_amount', sas.provider_amount,
        'platform_amount', sas.platform_amount,
        'deposit_amount', sas.deposit_amount,
        'food_amount', sas.food_amount,
        'total_amount', sas.total_amount,
        'currency', sas.currency,
        'settlement_version', sas.settlement_version,
        'idempotency_key', sas.idempotency_key,
        'metadata', sas.metadata
      ) AS metadata,
      CONCAT_WS(' ', sas.id, sas.reservation_id, sas.payment_id, sas.payment_session_id, sas.idempotency_key)::text AS search_text
    FROM settlement_allocation_snapshots sas
  `;
}

function providerSettlementsSource() {
  return `
    SELECT
      'financial'::text AS domain,
      ps.created_at::timestamptz AS event_time,
      'provider'::text AS actor_type,
      ps.provider_id::text AS actor_id,
      provider.name::text AS actor_label,
      CONCAT('provider_settlement_', ps.status)::text AS action,
      'provider_settlement'::text AS target_type,
      ps.id::text AS target_id,
      ps.id::text AS target_label,
      'PROVIDER_SETTLEMENT_RECORDED'::text AS event_type,
      CONCAT('Provider settlement ', ps.status, ' ', ps.amount, ' ', ps.currency)::text AS details,
      'provider_settlements'::text AS source_table,
      ps.id::text AS source_event_id,
      ps.id::text AS source_record_id,
      ps.id::text AS event_identifier,
      CONCAT('provider_settlements:', ps.id::text)::text AS record_identifier,
      72::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'provider_id', ps.provider_id,
        'reservation_id', ps.reservation_id,
        'payment_id', ps.payment_id,
        'payment_session_id', ps.payment_session_id,
        'settlement_allocation_id', ps.settlement_allocation_id,
        'settlement_batch_id', ps.settlement_batch_id,
        'amount', ps.amount,
        'commission_amount', ps.commission_amount,
        'currency', ps.currency,
        'status', ps.status,
        'idempotency_key', ps.idempotency_key,
        'metadata', ps.metadata
      ) AS metadata,
      CONCAT_WS(' ', ps.id, ps.provider_id, ps.reservation_id, ps.payment_id, ps.payment_session_id, ps.settlement_batch_id, ps.status, ps.idempotency_key)::text AS search_text
    FROM provider_settlements ps
    LEFT JOIN users provider ON provider.id = ps.provider_id
  `;
}

function settlementBatchesSource() {
  return `
    SELECT
      'financial'::text AS domain,
      sb.created_at::timestamptz AS event_time,
      'system'::text AS actor_type,
      NULL::text AS actor_id,
      NULL::text AS actor_label,
      CONCAT('settlement_batch_', sb.status)::text AS action,
      'settlement_batch'::text AS target_type,
      sb.id::text AS target_id,
      sb.batch_reference::text AS target_label,
      'SETTLEMENT_BATCH_RECORDED'::text AS event_type,
      CONCAT('Settlement batch ', sb.status, ' ', sb.provider_total, ' ', sb.currency)::text AS details,
      'settlement_batches'::text AS source_table,
      sb.id::text AS source_event_id,
      sb.id::text AS source_record_id,
      sb.batch_reference::text AS event_identifier,
      CONCAT('settlement_batches:', sb.id::text)::text AS record_identifier,
      73::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'batch_reference', sb.batch_reference,
        'status', sb.status,
        'currency', sb.currency,
        'provider_total', sb.provider_total,
        'commission_total', sb.commission_total,
        'metadata', sb.metadata
      ) AS metadata,
      CONCAT_WS(' ', sb.id, sb.batch_reference, sb.status, sb.currency)::text AS search_text
    FROM settlement_batches sb
  `;
}

function financialOperationsSource() {
  return `
    SELECT
      'financial'::text AS domain,
      fo.created_at::timestamptz AS event_time,
      COALESCE(fo.actor_role, actor.role, 'system')::text AS actor_type,
      fo.actor_user_id::text AS actor_id,
      actor.name::text AS actor_label,
      fo.operation_type::text AS action,
      COALESCE(fo.operation_source, 'financial_operation')::text AS target_type,
      COALESCE(fo.reservation_id::text, fo.payment_session_id, fo.id::text)::text AS target_id,
      COALESCE(fo.reservation_id::text, fo.payment_session_id, fo.id::text)::text AS target_label,
      fo.operation_type::text AS event_type,
      CONCAT(fo.operation_type, ' ', fo.status, ' ', fo.amount, ' ', fo.currency)::text AS details,
      'financial_operations'::text AS source_table,
      fo.id::text AS source_event_id,
      fo.id::text AS source_record_id,
      fo.id::text AS event_identifier,
      CONCAT('financial_operations:', fo.id::text)::text AS record_identifier,
      74::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'operation_type', fo.operation_type,
        'operation_source', fo.operation_source,
        'reservation_id', fo.reservation_id,
        'payment_session_id', fo.payment_session_id,
        'payment_ownership_id', fo.payment_ownership_id,
        'amount', fo.amount,
        'currency', fo.currency,
        'idempotency_key', fo.idempotency_key,
        'status', fo.status,
        'retry_count', fo.retry_count,
        'metadata', fo.metadata,
        'updated_at', fo.updated_at
      ) AS metadata,
      CONCAT_WS(' ', fo.id, fo.operation_type, fo.operation_source, fo.reservation_id, fo.payment_session_id, fo.idempotency_key, fo.status)::text AS search_text
    FROM financial_operations fo
    LEFT JOIN users actor ON actor.id = fo.actor_user_id
  `;
}

function financialStateTransitionsSource() {
  return `
    SELECT
      'financial'::text AS domain,
      fst.created_at::timestamptz AS event_time,
      'system'::text AS actor_type,
      NULL::text AS actor_id,
      NULL::text AS actor_label,
      'financial_state_transition'::text AS action,
      'payment'::text AS target_type,
      fst.payment_id::text AS target_id,
      COALESCE(fst.order_id, fst.payment_id::text)::text AS target_label,
      'FINANCIAL_STATE_TRANSITION'::text AS event_type,
      CONCAT_WS(' -> ', fst.old_payment_status, fst.new_payment_status)::text AS details,
      'financial_state_transitions'::text AS source_table,
      fst.id::text AS source_event_id,
      fst.id::text AS source_record_id,
      fst.id::text AS event_identifier,
      CONCAT('financial_state_transitions:', fst.id::text)::text AS record_identifier,
      75::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'payment_id', fst.payment_id,
        'reservation_id', fst.reservation_id,
        'order_id', fst.order_id,
        'old_payment_status', fst.old_payment_status,
        'new_payment_status', fst.new_payment_status,
        'old_refund_status', fst.old_refund_status,
        'new_refund_status', fst.new_refund_status,
        'old_deposit_status', fst.old_deposit_status,
        'new_deposit_status', fst.new_deposit_status,
        'transition_source', fst.transition_source,
        'metadata', fst.metadata
      ) AS metadata,
      CONCAT_WS(' ', fst.id, fst.payment_id, fst.reservation_id, fst.order_id, fst.old_payment_status, fst.new_payment_status, fst.old_refund_status, fst.new_refund_status, fst.transition_source)::text AS search_text
    FROM financial_state_transitions fst
  `;
}

function financialRefundTerminalSource() {
  return `
    SELECT
      'financial'::text AS domain,
      frtr.created_at::timestamptz AS event_time,
      'system'::text AS actor_type,
      NULL::text AS actor_id,
      NULL::text AS actor_label,
      CONCAT('refund_', frtr.terminal_status)::text AS action,
      'reservation'::text AS target_type,
      frtr.reservation_id::text AS target_id,
      frtr.reservation_id::text AS target_label,
      'FINANCIAL_REFUND_TERMINAL_RECORDED'::text AS event_type,
      CONCAT(frtr.refund_type, ' ', frtr.terminal_status, ' ', frtr.amount, ' ', frtr.currency)::text AS details,
      'financial_refund_terminal_records'::text AS source_table,
      frtr.id::text AS source_event_id,
      frtr.id::text AS source_record_id,
      frtr.id::text AS event_identifier,
      CONCAT('financial_refund_terminal_records:', frtr.id::text)::text AS record_identifier,
      76::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'reservation_id', frtr.reservation_id,
        'payment_session_id', frtr.payment_session_id,
        'payment_id', frtr.payment_id,
        'refund_type', frtr.refund_type,
        'refund_id', frtr.refund_id,
        'terminal_status', frtr.terminal_status,
        'amount', frtr.amount,
        'currency', frtr.currency,
        'idempotency_key', frtr.idempotency_key,
        'metadata', frtr.metadata
      ) AS metadata,
      CONCAT_WS(' ', frtr.id, frtr.reservation_id, frtr.payment_session_id, frtr.payment_id, frtr.refund_type, frtr.refund_id, frtr.terminal_status, frtr.idempotency_key)::text AS search_text
    FROM financial_refund_terminal_records frtr
  `;
}

function cashfreeWebhookAuditSource() {
  return `
    SELECT
      'financial'::text AS domain,
      cwal.received_at::timestamptz AS event_time,
      'gateway'::text AS actor_type,
      NULL::text AS actor_id,
      'Cashfree'::text AS actor_label,
      COALESCE(cwal.event_type, cwal.processing_status)::text AS action,
      CASE
        WHEN cwal.refund_id IS NOT NULL THEN 'refund'
        WHEN cwal.order_id IS NOT NULL THEN 'payment_order'
        WHEN cwal.cf_payment_id IS NOT NULL THEN 'cashfree_payment'
        ELSE 'cashfree_webhook'
      END::text AS target_type,
      COALESCE(cwal.order_id, cwal.refund_id, cwal.cf_payment_id, cwal.id::text)::text AS target_id,
      COALESCE(cwal.order_id, cwal.refund_id, cwal.cf_payment_id, cwal.id::text)::text AS target_label,
      COALESCE(cwal.event_type, 'CASHFREE_WEBHOOK_AUDIT')::text AS event_type,
      CONCAT('Cashfree webhook ', cwal.processing_status)::text AS details,
      'cashfree_webhook_audit_log'::text AS source_table,
      cwal.id::text AS source_event_id,
      cwal.id::text AS source_record_id,
      COALESCE(cwal.idempotency_key, cwal.id::text)::text AS event_identifier,
      CONCAT('cashfree_webhook_audit_log:', cwal.id::text)::text AS record_identifier,
      77::int AS source_rank,
      true::boolean AS immutable,
      jsonb_build_object(
        'idempotency_key', cwal.idempotency_key,
        'event_type', cwal.event_type,
        'order_id', cwal.order_id,
        'cf_payment_id', cwal.cf_payment_id,
        'refund_id', cwal.refund_id,
        'processing_status', cwal.processing_status,
        'payload_hash', cwal.payload_hash,
        'signature_present', cwal.signature_present,
        'webhook_timestamp', cwal.webhook_timestamp,
        'rejection_reason', cwal.rejection_reason,
        'metadata', cwal.metadata
      ) AS metadata,
      CONCAT_WS(' ', cwal.id, cwal.idempotency_key, cwal.event_type, cwal.order_id, cwal.cf_payment_id, cwal.refund_id, cwal.processing_status, cwal.payload_hash, cwal.rejection_reason)::text AS search_text
    FROM cashfree_webhook_audit_log cwal
  `;
}

function paymentOrderAttemptsSource() {
  return `
    SELECT
      'financial'::text AS domain,
      poa.created_at::timestamptz AS event_time,
      COALESCE(payer.role, 'user')::text AS actor_type,
      poa.payer_user_id::text AS actor_id,
      payer.name::text AS actor_label,
      CONCAT('payment_order_attempt_', poa.status)::text AS action,
      'payment_order_attempt'::text AS target_type,
      poa.order_id::text AS target_id,
      COALESCE(poa.order_id, poa.payment_session_id, poa.id::text)::text AS target_label,
      'PAYMENT_ORDER_ATTEMPT_RECORDED'::text AS event_type,
      CONCAT('Payment order attempt ', poa.status, ' ', poa.amount, ' ', poa.currency)::text AS details,
      'payment_order_attempts'::text AS source_table,
      poa.id::text AS source_event_id,
      poa.id::text AS source_record_id,
      poa.order_id::text AS event_identifier,
      CONCAT('payment_order_attempts:', poa.id::text)::text AS record_identifier,
      78::int AS source_rank,
      false::boolean AS immutable,
      jsonb_build_object(
        'order_id', poa.order_id,
        'payer_user_id', poa.payer_user_id,
        'reservation_count', COALESCE(array_length(poa.reservation_ids, 1), 0),
        'amount', poa.amount,
        'currency', poa.currency,
        'status', poa.status,
        'payment_session_id', poa.payment_session_id,
        'failure_reason', poa.failure_reason,
        'recovery_attempts', poa.recovery_attempts,
        'updated_at', poa.updated_at,
        'recovered_at', poa.recovered_at
      ) AS metadata,
      CONCAT_WS(' ', poa.id, poa.order_id, poa.payer_user_id, poa.payment_session_id, poa.status, poa.failure_reason)::text AS search_text
    FROM payment_order_attempts poa
    LEFT JOIN users payer ON payer.id = poa.payer_user_id
  `;
}

const SOURCE_BRANCHES = {
  trust: [trustEventsSource, adminTrustActionsSource],
  moderation: [
    providerReportsSource,
    providerReportAttachmentsSource,
    moderationCasesSource,
    moderationCaseEventsSource,
  ],
  appeals: [moderationAppealsSource, moderationAppealEventsSource],
  verification: [verificationOperationalEventsSource],
  governance: [governanceOperationalEventsSource],
  incidents: [incidentEventsSource],
  financial: [
    financialLedgerSource,
    settlementAllocationsSource,
    providerSettlementsSource,
    settlementBatchesSource,
    financialOperationsSource,
    financialStateTransitionsSource,
    financialRefundTerminalSource,
    cashfreeWebhookAuditSource,
    paymentOrderAttemptsSource,
  ],
  notifications: [notificationsSource],
  compliance: [complianceEventsSource],
};

function buildAuditEventsSql(filters) {
  const params = [];
  const branches = filters.domains
    .flatMap((domain) => SOURCE_BRANCHES[domain] || [])
    .map((sourceBuilder) => sourceBuilder());

  const where = [];

  if (filters.actorType) {
    const actorTypeParam = addParam(params, filters.actorType);
    where.push(
      `(LOWER(COALESCE(actor_type, '')) = ${actorTypeParam} OR LOWER(COALESCE(target_type, '')) = ${actorTypeParam})`
    );
  }

  if (filters.actorId) {
    const actorIdParam = addParam(params, filters.actorId.toLowerCase());
    where.push(`(
      LOWER(COALESCE(actor_id, '')) = ${actorIdParam}
      OR LOWER(COALESCE(target_id, '')) = ${actorIdParam}
      OR LOWER(COALESCE(search_text, '')) LIKE '%' || ${actorIdParam} || '%'
    )`);
  }

  if (filters.search) {
    const searchParam = addParam(params, filters.search.toLowerCase());
    where.push(`LOWER(COALESCE(search_text, '')) LIKE '%' || ${searchParam} || '%'`);
  }

  if (filters.startAt) {
    where.push(`event_time >= ${addParam(params, filters.startAt)}::timestamptz`);
  }

  if (filters.endAt) {
    where.push(`event_time <= ${addParam(params, filters.endAt)}::timestamptz`);
  }

  if (filters.cursor) {
    const cursorTime = addParam(params, filters.cursor.eventTime);
    const cursorRank = addParam(params, filters.cursor.sourceRank);
    const cursorId = addParam(params, filters.cursor.sourceRecordId);
    where.push(`(
      event_time < ${cursorTime}::timestamptz
      OR (event_time = ${cursorTime}::timestamptz AND source_rank > ${cursorRank}::int)
      OR (
        event_time = ${cursorTime}::timestamptz
        AND source_rank = ${cursorRank}::int
        AND source_record_id < ${cursorId}
      )
    )`);
  }

  const limitParam = addParam(params, filters.limit + 1);
  const whereSql = where.length ? `WHERE ${where.join("\n      AND ")}` : "";

  return {
    sql: `
      WITH audit_events AS (
        ${branches.join("\n        UNION ALL\n")}
      )
      SELECT
        domain,
        event_time,
        actor_type,
        actor_id,
        actor_label,
        action,
        target_type,
        target_id,
        target_label,
        event_type,
        details,
        source_table,
        source_event_id,
        source_record_id,
        event_identifier,
        record_identifier,
        source_rank,
        immutable,
        metadata
      FROM audit_events
      ${whereSql}
      ORDER BY event_time DESC NULLS LAST, source_rank ASC, source_record_id DESC
      LIMIT ${limitParam}
    `,
    params,
  };
}

function isSensitiveKey(key) {
  const lower = String(key || "").toLowerCase();
  if (lower === "payload" || lower.endsWith("_payload")) return true;
  if (lower === "gateway_response" || lower === "reservation_snapshot") return true;
  if (lower === "signature" || lower.endsWith("_signature")) return true;
  return /(password|token|secret|authorization|cookie|otp|refresh_token)/i.test(lower);
}

function sanitizeMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    sanitized[key] = sanitizeMetadata(item);
  }
  return sanitized;
}

function eventHref(row) {
  const metadata = row.metadata || {};
  if (row.domain === "trust" && row.target_type && row.target_id) {
    return `/admin/trust?subjectType=${encodeURIComponent(row.target_type)}&subjectId=${encodeURIComponent(row.target_id)}`;
  }
  if (row.domain === "moderation") {
    const caseId = metadata.case_id || metadata.moderation_case_id;
    if (caseId) return `/admin/moderation-cases/${encodeURIComponent(String(caseId))}`;
    return "/admin/provider-reports?status=all";
  }
  if (row.domain === "appeals") {
    if (metadata.case_id) return `/admin/moderation-cases/${encodeURIComponent(String(metadata.case_id))}`;
    return "/admin/moderation-appeals?status=all";
  }
  if (row.domain === "verification") {
    return row.target_type === "ngo" ? "/admin/ngos" : "/admin/restaurants";
  }
  if (row.domain === "governance") return "/admin/governance-intelligence";
  if (row.domain === "incidents" && row.target_id) {
    return `/admin/incidents?q=${encodeURIComponent(String(row.target_id))}`;
  }
  if (row.domain === "notifications") return "/notifications";
  if (row.domain === "compliance") {
    const requestId = metadata.deletion_request_id;
    if (requestId) {
      return `/admin/compliance?requestId=${encodeURIComponent(String(requestId))}`;
    }
    return "/admin/compliance";
  }
  return "/admin";
}

function normalizeAuditRow(row) {
  const metadata = sanitizeMetadata(row.metadata || {});

  return {
    domain: row.domain,
    timestamp: row.event_time instanceof Date ? row.event_time.toISOString() : row.event_time,
    actor: {
      type: row.actor_type || "system",
      id: row.actor_id || null,
      label: row.actor_label || null,
    },
    action: row.action,
    target: {
      type: row.target_type || null,
      id: row.target_id || null,
      label: row.target_label || null,
    },
    event_type: row.event_type,
    details: row.details || "",
    source: {
      domain: row.domain,
      table: row.source_table,
      event_identifier: row.event_identifier || row.source_event_id,
      record_identifier: row.record_identifier,
      source_event_id: row.source_event_id,
      source_record_id: row.source_record_id,
      immutable: Boolean(row.immutable),
    },
    metadata,
    href: eventHref({ ...row, metadata }),
  };
}

async function listAuditEvents(options = {}) {
  const client = options.client || pool;
  const filters =
    options.normalizedFilters || normalizeAuditFilters(options, options.config || {});
  const query = buildAuditEventsSql(filters);
  const result = await client.query(query.sql, query.params);
  const rows = result.rows || [];
  const pageRows = rows.slice(0, filters.limit);
  const hasMore = rows.length > filters.limit;
  const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null;

  return {
    filters,
    events: pageRows.map(normalizeAuditRow),
    pagination: {
      limit: filters.limit,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}

async function getAuditCenter(options = {}) {
  const client = options.client || pool;
  const filters = normalizeAuditFilters(options);
  const adminFilters = {
    ...filters,
    domains: ["trust", "moderation", "appeals", "verification", "incidents", "compliance"],
    actorType: "admin",
    actorId: null,
    cursor: null,
    rawCursor: null,
    limit: 12,
  };

  const [timeline, recentAdmin] = await Promise.all([
    listAuditEvents({ client, normalizedFilters: filters }),
    listAuditEvents({ client, normalizedFilters: adminFilters }),
  ]);

  return {
    generated_at: new Date().toISOString(),
    informational_only: true,
    enforcement_action: null,
    filters: publicFilters(filters),
    pagination: timeline.pagination,
    events: timeline.events,
    recent_admin_actions: recentAdmin.events,
    source_inventory: SOURCE_INVENTORY,
    analysis: ANALYSIS,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function eventsToCsv(events = []) {
  const headers = [
    "timestamp",
    "domain",
    "actor_type",
    "actor_id",
    "actor",
    "action",
    "target_type",
    "target_id",
    "target",
    "event_type",
    "details",
    "event_source",
    "event_identifier",
    "record_identifier",
    "immutable",
    "metadata",
  ];

  const lines = [headers.map(csvCell).join(",")];
  for (const event of events) {
    lines.push(
      [
        event.timestamp,
        event.domain,
        event.actor?.type,
        event.actor?.id,
        event.actor?.label,
        event.action,
        event.target?.type,
        event.target?.id,
        event.target?.label,
        event.event_type,
        event.details,
        event.source?.table,
        event.source?.event_identifier,
        event.source?.record_identifier,
        event.source?.immutable ? "true" : "false",
        JSON.stringify(event.metadata || {}),
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

async function exportAuditEvents(options = {}) {
  const filters = normalizeAuditFilters(options, { exportMode: true });
  const result = await listAuditEvents({
    client: options.client || pool,
    normalizedFilters: {
      ...filters,
      cursor: null,
      rawCursor: null,
    },
  });

  return {
    generated_at: new Date().toISOString(),
    filters: publicFilters(filters),
    count: result.events.length,
    events: result.events,
  };
}

module.exports = {
  ACTOR_TYPES,
  AUDIT_DOMAINS,
  ANALYSIS,
  SOURCE_INVENTORY,
  buildAuditEventsSql,
  eventsToCsv,
  exportAuditEvents,
  getAuditCenter,
  listAuditEvents,
  normalizeAuditFilters,
  sanitizeMetadata,
};
