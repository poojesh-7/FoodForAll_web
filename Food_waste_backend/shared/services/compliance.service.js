const pool = require("../config/db");
const { assertAdmin } = require("./authorization.service");
const {
  sanitizeOptionalText,
  sanitizePlainText,
} = require("../utils/sanitize");
const { isValidId } = require("../../utils/validation");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const REQUEST_TYPES = new Set([
  "account_deletion",
  "data_access",
  "anonymization",
  "evidence_deletion",
  "notification_cleanup",
]);

const SUBJECT_TYPES = new Set([
  "user",
  "provider",
  "ngo",
  "volunteer",
  "admin",
  "provider_report_attachment",
  "moderation_appeal_attachment",
  "notification",
  "other",
]);

const REQUEST_STATUSES = new Set([
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
  "CANCELLED",
]);

const ACTIVE_REQUEST_STATUSES = new Set([
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
]);

const EVIDENCE_TABLES = {
  provider_report_attachment: {
    table: "provider_report_attachments",
    idColumn: "id",
    parentColumn: "report_id",
    targetType: "provider_report_attachment",
  },
  moderation_appeal_attachment: {
    table: "moderation_appeal_attachments",
    idColumn: "id",
    parentColumn: "appeal_id",
    targetType: "moderation_appeal_attachment",
  },
};

const STATUS_TRANSITIONS = {
  REQUESTED: new Set(["UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED"]),
  UNDER_REVIEW: new Set(["APPROVED", "REJECTED", "CANCELLED"]),
  APPROVED: new Set(["EXECUTED", "CANCELLED"]),
  REJECTED: new Set([]),
  EXECUTED: new Set([]),
  CANCELLED: new Set([]),
};

const ANALYSIS = {
  architecture: [
    "T7.5 adds a compliance control plane beside existing trust, financial, governance, audit, incident, and notification systems.",
    "Retention policies are centralized in retention_policies and describe retention duration, archive timing, deletion eligibility, and protected integrity domains.",
    "Data deletion requests are workflow records; request, review, approval, and execution are separate steps and every step emits immutable compliance_events.",
    "Execution favors anonymization and archival markers over physical deletion so financial reconciliation, trust replay, auditability, and investigations remain intact.",
    "Evidence archival preserves Cloudinary asset references and source-row lineage instead of deleting provider report or appeal history.",
    "The dashboard is a read model over owning tables and does not recompute financial balances, trust formulas, moderation states, or incident states.",
  ],
  gaps: [
    "Notification delivery attempts are still represented by notification rows and worker observability; there is no dedicated delivery-attempt table.",
    "Cloudinary assets currently have durable URLs but no separate cold-storage bucket, so archival means retaining the Cloudinary reference with archive state and metadata.",
    "Historical provider/NGO legal identity may be required for settlements or investigations; account deletion therefore anonymizes user contact fields instead of deleting business records.",
    "Retention enforcement is manual/admin-driven in T7.5; automatic destruction is intentionally absent until legal hold and investigation checks are more mature.",
    "Data access export generation is summarized by this phase but does not yet produce a downloadable subject data bundle.",
  ],
  reuse: [
    "Trust replay: trust_events, trust_event_effects, trust_scores, and trust_restrictions are retained and never deleted by compliance execution.",
    "Financial integrity: financial_ledger_entries, provider_settlements, settlement_allocation_snapshots, settlement_batches, payment ownership, webhook audit, and refund terminal records remain immutable or protected.",
    "Governance history: provider_reports, provider_report_attachments, moderation_cases, moderation_case_events, moderation_appeals, and appeal events remain discoverable.",
    "Audit Center: compliance_events is added as a first-class audit domain while operational_events keeps security/operations visibility.",
    "Incidents: incident_records, incident_events, notes, and postmortems remain immutable investigation records.",
    "Notifications: existing notification rows are reused with archive state instead of silent deletion.",
  ],
  risks: [
    "Deleting user rows would break foreign-keyed ledgers, settlements, trust subjects, reports, appeals, and incidents; execution therefore anonymizes selected user PII only.",
    "Evidence loss would weaken moderation history; evidence deletion requests are executed as archive/retain actions unless a future approved legal process introduces physical deletion.",
    "Audit loss would make compliance unverifiable; compliance_events is immutable and audit records have a never-delete default policy.",
    "Trust replay loss would alter enforcement history; trust replay sources are excluded from destructive paths.",
    "Notification tables can continue to grow; T7.5 converts cleanup to archival, and later storage-tier movement can operate on archive_status without losing discoverability.",
  ],
  retentionPolicyDesign: [
    "Indefinite policies: audit_records, financial_records, trust_replay_records, and privacy_requests.",
    "Long-lived investigation policies: governance_records and incident_records retain for 2555 days and archive after 1095 days while remaining searchable.",
    "Evidence policy: provider and appeal evidence retains for 1095 days, becomes archive-eligible after 365 days, and preserves Cloudinary references.",
    "Notification policy: notifications retain active visibility for 365 days, become archive-eligible after 180 days, and require controlled approval before deletion.",
  ],
  privacyWorkflow: [
    "Create a request with subject, reason, and policy.",
    "Review moves the request to UNDER_REVIEW and captures reviewer notes.",
    "Approval captures a protection snapshot for financial, trust, governance, incident, notification, and evidence links.",
    "Execution performs anonymization or archival and records an immutable compliance event.",
    "Rejected or cancelled requests remain auditable and are not removed.",
  ],
  archivalStrategy: [
    "Evidence archival marks provider_report_attachments and moderation_appeal_attachments as archived while preserving file_url and archive_reference.",
    "Notification archival marks aged notification rows archived instead of deleting them.",
    "Archive records in data_archive_records provide a source-table/source-id inventory for discoverability.",
    "Archived records remain searchable through Compliance Dashboard and relevant Audit Center source domains.",
  ],
  manualTestPlan: [
    "Create a user account deletion request and verify status REQUESTED.",
    "Review then approve the request and verify compliance_events contains both actions.",
    "Execute the request and verify user contact fields are anonymized while user id remains stable.",
    "Verify financial ledger, settlement, refund, reconciliation, and webhook audit counts are unchanged.",
    "Verify trust events/effects/scores remain queryable for the subject id.",
    "Archive a provider report or appeal attachment and verify the Cloudinary URL remains stored.",
    "Open Audit Center with compliance domain and verify compliance actions are discoverable.",
    "Verify notification cleanup marks old notifications archived instead of deleting them.",
  ],
};

function withStatus(message, statusCode, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function toFloat(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLimit(value) {
  return Math.max(1, Math.min(toInt(value, DEFAULT_LIMIT), MAX_LIMIT));
}

function normalizeStatus(value) {
  const status = sanitizePlainText(value || "", { maxLength: 40 }).toUpperCase();
  if (!status) return null;
  if (!REQUEST_STATUSES.has(status)) {
    throw withStatus("Invalid deletion request status", 400);
  }
  return status;
}

function normalizeRequestType(value) {
  const requestType = sanitizePlainText(value || "", { maxLength: 80 }).toLowerCase();
  if (!REQUEST_TYPES.has(requestType)) {
    throw withStatus("Invalid compliance request type", 400);
  }
  return requestType;
}

function normalizeSubjectType(value) {
  const subjectType = sanitizePlainText(value || "", { maxLength: 80 }).toLowerCase();
  if (!SUBJECT_TYPES.has(subjectType)) {
    throw withStatus("Invalid compliance subject type", 400);
  }
  return subjectType;
}

function normalizeEvidenceType(value) {
  const evidenceType = normalizeSubjectType(value);
  if (!EVIDENCE_TABLES[evidenceType]) {
    throw withStatus("Invalid evidence type", 400);
  }
  return evidenceType;
}

function normalizeSubjectId(value, subjectType) {
  const subjectId = sanitizePlainText(value, { maxLength: 160 });
  if (!subjectId) {
    throw withStatus("Subject id is required", 400);
  }

  if (
    [
      "user",
      "provider",
      "ngo",
      "volunteer",
      "admin",
      "provider_report_attachment",
      "moderation_appeal_attachment",
      "notification",
    ].includes(subjectType) &&
    !isValidId(subjectId)
  ) {
    throw withStatus("Subject id must be a valid id", 400);
  }

  return subjectId;
}

function normalizeOptionalId(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const id = String(value).trim();
  if (!isValidId(id)) {
    throw withStatus(`${fieldName} must be a valid id`, 400);
  }
  return id;
}

function normalizeMetadata(value, fieldName = "metadata") {
  if (!value) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw withStatus(`${fieldName} must be an object`, 400);
  }

  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw withStatus(`${fieldName} must be serializable`, 400);
  }

  if (encoded.length > 20000) {
    throw withStatus(`${fieldName} is too large`, 400);
  }

  return JSON.parse(encoded);
}

function policyForRequestType(requestType) {
  if (requestType === "evidence_deletion") return "evidence_records";
  if (requestType === "notification_cleanup") return "notifications";
  return "privacy_requests";
}

function targetUserFromSubject(subjectType, subjectId, explicitTargetUserId) {
  if (explicitTargetUserId) return explicitTargetUserId;
  if (["user", "provider", "ngo", "volunteer", "admin"].includes(subjectType)) {
    return subjectId;
  }
  return null;
}

function publicRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    request_type: row.request_type,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    target_user_id: row.target_user_id || null,
    target_user_name: row.target_user_name || null,
    requested_by_user_id: row.requested_by_user_id || null,
    requested_by_name: row.requested_by_name || null,
    status: row.status,
    reason: row.reason,
    review_note: row.review_note || null,
    decision_note: row.decision_note || null,
    execution_summary: row.execution_summary || null,
    legal_hold: Boolean(row.legal_hold),
    policy_key: row.policy_key,
    approval_snapshot: row.approval_snapshot || {},
    execution_result: row.execution_result || {},
    requested_at: row.requested_at,
    reviewed_by_admin_id: row.reviewed_by_admin_id || null,
    reviewed_by_admin_name: row.reviewed_by_admin_name || null,
    reviewed_at: row.reviewed_at || null,
    approved_by_admin_id: row.approved_by_admin_id || null,
    approved_by_admin_name: row.approved_by_admin_name || null,
    approved_at: row.approved_at || null,
    executed_by_admin_id: row.executed_by_admin_id || null,
    executed_by_admin_name: row.executed_by_admin_name || null,
    executed_at: row.executed_at || null,
    updated_at: row.updated_at,
  };
}

function deletionRequestSelect(whereSql = "", suffixSql = "") {
  return `
    SELECT ddr.*,
           requested_by.name AS requested_by_name,
           target_user.name AS target_user_name,
           reviewed_by.name AS reviewed_by_admin_name,
           approved_by.name AS approved_by_admin_name,
           executed_by.name AS executed_by_admin_name
    FROM data_deletion_requests ddr
    LEFT JOIN users requested_by ON requested_by.id = ddr.requested_by_user_id
    LEFT JOIN users target_user ON target_user.id = ddr.target_user_id
    LEFT JOIN users reviewed_by ON reviewed_by.id = ddr.reviewed_by_admin_id
    LEFT JOIN users approved_by ON approved_by.id = ddr.approved_by_admin_id
    LEFT JOIN users executed_by ON executed_by.id = ddr.executed_by_admin_id
    ${whereSql}
    ${suffixSql}
  `;
}

async function queryOne(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || {};
}

async function getRetentionPolicies({ client = pool } = {}) {
  const result = await client.query(`
    SELECT policy_key,
           category,
           display_name,
           description,
           retention_duration_days,
           archive_after_days,
           delete_after_days,
           deletion_eligible,
           deletion_mode,
           archive_mode,
           legal_basis,
           immutable_source,
           searchable_when_archived,
           protects_financial_integrity,
           protects_trust_replay,
           protects_investigations,
           default_policy,
           metadata,
           created_at,
           updated_at
    FROM retention_policies
    ORDER BY category ASC, policy_key ASC
  `);

  return result.rows;
}

async function listDeletionRequests({
  client = pool,
  status = null,
  limit = DEFAULT_LIMIT,
} = {}) {
  const params = [];
  const where = [];
  const normalizedStatus = status ? normalizeStatus(status) : null;
  if (normalizedStatus) {
    params.push(normalizedStatus);
    where.push(`ddr.status=$${params.length}`);
  }
  params.push(normalizeLimit(limit));

  const result = await client.query(
    deletionRequestSelect(
      where.length ? `WHERE ${where.join(" AND ")}` : "",
      `ORDER BY ddr.requested_at DESC, ddr.id DESC LIMIT $${params.length}`
    ),
    params
  );

  return result.rows.map(publicRequest);
}

async function getDeletionRequestDetail({ client = pool, requestId }) {
  if (!isValidId(requestId)) {
    throw withStatus("Deletion request id is required", 400);
  }

  const requestResult = await client.query(
    deletionRequestSelect("WHERE ddr.id=$1", "LIMIT 1"),
    [requestId]
  );
  const request = publicRequest(requestResult.rows[0]);
  if (!request) return null;

  const eventResult = await client.query(
    `
    SELECT ce.*,
           actor.name AS actor_name
    FROM compliance_events ce
    LEFT JOIN users actor ON actor.id = ce.actor_user_id
    WHERE ce.deletion_request_id=$1
    ORDER BY ce.created_at ASC, ce.id ASC
    `,
    [requestId]
  );

  return {
    request,
    events: eventResult.rows,
    analysis: ANALYSIS,
  };
}

async function getDeletionRequestCounts({ client = pool } = {}) {
  const result = await client.query(`
    SELECT status, COUNT(*)::int AS count
    FROM data_deletion_requests
    GROUP BY status
    ORDER BY status ASC
  `);
  return result.rows;
}

function evidenceUnionSql() {
  return `
    SELECT
      'provider_report_attachment'::text AS evidence_type,
      pra.id::text AS id,
      pra.report_id::text AS parent_id,
      pra.uploader_user_id::text AS uploader_user_id,
      pra.file_url,
      pra.mime_type,
      pra.file_size_bytes,
      pra.retention_policy_key,
      pra.archive_status,
      pra.archived_at,
      pra.archive_reference,
      pra.archive_metadata,
      pra.retained_until,
      pra.created_at
    FROM provider_report_attachments pra
    UNION ALL
    SELECT
      'moderation_appeal_attachment'::text AS evidence_type,
      maa.id::text AS id,
      maa.appeal_id::text AS parent_id,
      maa.uploader_user_id::text AS uploader_user_id,
      maa.file_url,
      maa.mime_type,
      maa.file_size_bytes,
      maa.retention_policy_key,
      maa.archive_status,
      maa.archived_at,
      maa.archive_reference,
      maa.archive_metadata,
      maa.retained_until,
      maa.created_at
    FROM moderation_appeal_attachments maa
  `;
}

async function getEvidenceInventory({ client = pool, limit = 20 } = {}) {
  const [summary, recent] = await Promise.all([
    queryOne(
      client,
      `
      WITH evidence AS (${evidenceUnionSql()})
      SELECT
        COUNT(*)::int AS total_assets,
        COUNT(*) FILTER (WHERE archive_status='archived')::int AS archived_assets,
        COUNT(*) FILTER (
          WHERE archive_status='active'
          AND created_at < NOW() - INTERVAL '365 days'
        )::int AS archive_candidates,
        COALESCE(SUM(file_size_bytes), 0)::bigint AS total_bytes,
        MAX(created_at) AS newest_asset_at,
        MIN(created_at) AS oldest_asset_at
      FROM evidence
      `
    ),
    client.query(
      `
      WITH evidence AS (${evidenceUnionSql()})
      SELECT *
      FROM evidence
      ORDER BY created_at DESC, id DESC
      LIMIT $1
      `,
      [normalizeLimit(limit)]
    ),
  ]);

  return {
    summary: {
      total_assets: toInt(summary.total_assets),
      archived_assets: toInt(summary.archived_assets),
      archive_candidates: toInt(summary.archive_candidates),
      total_bytes: toFloat(summary.total_bytes),
      newest_asset_at: summary.newest_asset_at || null,
      oldest_asset_at: summary.oldest_asset_at || null,
      storage_provider: "cloudinary",
      deletion_default: "no_physical_delete",
    },
    recent: recent.rows,
  };
}

async function getNotificationRetentionStatus({ client = pool } = {}) {
  const row = await queryOne(
    client,
    `
    SELECT
      COUNT(*)::int AS total_notifications,
      COUNT(*) FILTER (WHERE archive_status='active')::int AS active_notifications,
      COUNT(*) FILTER (WHERE archive_status='archived')::int AS archived_notifications,
      COUNT(*) FILTER (
        WHERE archive_status='active'
        AND created_at < NOW() - INTERVAL '180 days'
      )::int AS archive_candidates,
      COUNT(*) FILTER (
        WHERE created_at < NOW() - INTERVAL '730 days'
      )::int AS deletion_review_candidates,
      MIN(created_at) AS oldest_notification_at,
      MAX(created_at) AS newest_notification_at
    FROM notifications
    `
  );

  return {
    total_notifications: toInt(row.total_notifications),
    active_notifications: toInt(row.active_notifications),
    archived_notifications: toInt(row.archived_notifications),
    archive_candidates: toInt(row.archive_candidates),
    deletion_review_candidates: toInt(row.deletion_review_candidates),
    oldest_notification_at: row.oldest_notification_at || null,
    newest_notification_at: row.newest_notification_at || null,
    default_action: "archive_without_silent_delete",
  };
}

async function getFinancialRetentionStatus({ client = pool } = {}) {
  const row = await queryOne(
    client,
    `
    SELECT
      (SELECT COUNT(*)::int FROM financial_ledger_entries) AS ledger_entries,
      (SELECT COUNT(*)::int FROM settlement_allocation_snapshots) AS settlement_allocations,
      (SELECT COUNT(*)::int FROM provider_settlements) AS provider_settlements,
      (SELECT COUNT(*)::int FROM settlement_batches) AS settlement_batches,
      (SELECT COUNT(*)::int FROM financial_refund_terminal_records) AS refund_terminal_records,
      (SELECT COUNT(*)::int FROM cashfree_webhook_audit_log) AS webhook_audit_records,
      (SELECT COUNT(*)::int FROM payment_order_attempts) AS payment_order_attempts,
      (SELECT COUNT(*)::int FROM payments WHERE reconciliation_status IS NOT NULL) AS reconciliation_records
    `
  );

  return {
    ledger_entries: toInt(row.ledger_entries),
    settlement_allocations: toInt(row.settlement_allocations),
    provider_settlements: toInt(row.provider_settlements),
    settlement_batches: toInt(row.settlement_batches),
    refund_terminal_records: toInt(row.refund_terminal_records),
    webhook_audit_records: toInt(row.webhook_audit_records),
    payment_order_attempts: toInt(row.payment_order_attempts),
    reconciliation_records: toInt(row.reconciliation_records),
    deletion_allowed: false,
    retention_policy_key: "financial_records",
  };
}

async function getTrustRetentionStatus({ client = pool } = {}) {
  const row = await queryOne(
    client,
    `
    SELECT
      (SELECT COUNT(*)::int FROM trust_events) AS trust_events,
      (SELECT COUNT(*)::int FROM trust_event_effects) AS trust_event_effects,
      (SELECT COUNT(*)::int FROM trust_scores) AS trust_scores,
      (SELECT COUNT(*)::int FROM trust_restrictions) AS trust_restrictions,
      (SELECT COUNT(*)::int FROM trust_events WHERE processing_status IN ('pending','retry','processing')) AS replay_pending_events
    `
  );

  return {
    trust_events: toInt(row.trust_events),
    trust_event_effects: toInt(row.trust_event_effects),
    trust_scores: toInt(row.trust_scores),
    trust_restrictions: toInt(row.trust_restrictions),
    replay_pending_events: toInt(row.replay_pending_events),
    deletion_allowed: false,
    replay_required: true,
    retention_policy_key: "trust_replay_records",
  };
}

async function getAuditRetentionStatus({ client = pool } = {}) {
  const row = await queryOne(
    client,
    `
    SELECT
      (SELECT COUNT(*)::int FROM operational_events) AS operational_events,
      (SELECT COUNT(*)::int FROM compliance_events) AS compliance_events,
      (SELECT COUNT(*)::int FROM incident_events) AS incident_events,
      (SELECT COUNT(*)::int FROM financial_ledger_entries) AS financial_events,
      (SELECT COUNT(*)::int FROM trust_events) AS trust_events
    `
  );

  return {
    operational_events: toInt(row.operational_events),
    compliance_events: toInt(row.compliance_events),
    incident_events: toInt(row.incident_events),
    financial_events: toInt(row.financial_events),
    trust_events: toInt(row.trust_events),
    default_delete: false,
    searchable: true,
    retention_policy_key: "audit_records",
  };
}

async function getIncidentRetentionStatus({ client = pool } = {}) {
  const row = await queryOne(
    client,
    `
    SELECT
      (SELECT COUNT(*)::int FROM incident_records) AS incident_records,
      (SELECT COUNT(*)::int FROM incident_events) AS incident_events,
      (SELECT COUNT(*)::int FROM incident_notes) AS incident_notes,
      (SELECT COUNT(*)::int FROM incident_postmortems) AS incident_postmortems,
      (SELECT COUNT(*)::int FROM incident_postmortems WHERE created_at < NOW() - INTERVAL '1095 days') AS archive_candidates
    `
  );

  return {
    incident_records: toInt(row.incident_records),
    incident_events: toInt(row.incident_events),
    incident_notes: toInt(row.incident_notes),
    incident_postmortems: toInt(row.incident_postmortems),
    archive_candidates: toInt(row.archive_candidates),
    deletion_allowed: false,
    retention_policy_key: "incident_records",
  };
}

async function getArchiveSummary({ client = pool } = {}) {
  const result = await client.query(`
    SELECT policy_key,
           archive_status,
           COUNT(*)::int AS count,
           MAX(updated_at) AS last_updated_at
    FROM data_archive_records
    GROUP BY policy_key, archive_status
    ORDER BY policy_key ASC, archive_status ASC
  `);
  return result.rows;
}

async function getComplianceActivity({ client = pool, limit = 20 } = {}) {
  const [summary, recent] = await Promise.all([
    client.query(`
      SELECT event_type,
             COUNT(*)::int AS count,
             MAX(created_at) AS last_seen_at
      FROM compliance_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY event_type
      ORDER BY count DESC, event_type ASC
    `),
    client.query(
      `
      SELECT ce.*,
             actor.name AS actor_name
      FROM compliance_events ce
      LEFT JOIN users actor ON actor.id = ce.actor_user_id
      ORDER BY ce.created_at DESC, ce.id DESC
      LIMIT $1
      `,
      [normalizeLimit(limit)]
    ),
  ]);

  return {
    summary: summary.rows,
    recent: recent.rows,
  };
}

async function getComplianceDashboard(options = {}) {
  const client = options.client || pool;
  const limit = normalizeLimit(options.limit || 20);
  const [
    retentionPolicies,
    requestCounts,
    pendingRequests,
    recentRequests,
    evidenceInventory,
    notificationRetention,
    financialRetention,
    trustRetention,
    auditRetention,
    incidentRetention,
    archiveSummary,
    complianceActivity,
  ] = await Promise.all([
    getRetentionPolicies({ client }),
    getDeletionRequestCounts({ client }),
    listDeletionRequests({ client, status: options.status || null, limit }),
    listDeletionRequests({ client, limit }),
    getEvidenceInventory({ client, limit }),
    getNotificationRetentionStatus({ client }),
    getFinancialRetentionStatus({ client }),
    getTrustRetentionStatus({ client }),
    getAuditRetentionStatus({ client }),
    getIncidentRetentionStatus({ client }),
    getArchiveSummary({ client }),
    getComplianceActivity({ client, limit }),
  ]);

  const pendingCount = requestCounts
    .filter((row) => ACTIVE_REQUEST_STATUSES.has(row.status))
    .reduce((sum, row) => sum + toInt(row.count), 0);
  const complianceEvents30d = complianceActivity.summary.reduce(
    (sum, row) => sum + toInt(row.count),
    0
  );

  return {
    generated_at: new Date().toISOString(),
    informational_only: true,
    enforcement_action: null,
    summary: {
      retention_policies: retentionPolicies.length,
      pending_deletion_requests: pendingCount,
      evidence_assets: evidenceInventory.summary.total_assets,
      archived_evidence_assets: evidenceInventory.summary.archived_assets,
      notification_archive_candidates: notificationRetention.archive_candidates,
      compliance_events_30d: complianceEvents30d,
      financial_records_delete_locked: true,
      trust_replay_delete_locked: true,
      audit_records_delete_locked: true,
    },
    retention_policies: retentionPolicies,
    deletion_requests: {
      counts_by_status: requestCounts,
      pending: pendingRequests,
      recent: recentRequests,
    },
    evidence_inventory: evidenceInventory,
    notification_retention_status: notificationRetention,
    financial_retention_status: financialRetention,
    trust_retention_status: trustRetention,
    audit_retention_status: auditRetention,
    incident_retention_status: incidentRetention,
    archive_summary: archiveSummary,
    compliance_activity: complianceActivity,
    analysis: ANALYSIS,
  };
}

async function recordComplianceEvent({
  client = pool,
  eventType,
  actorUserId = null,
  actorType = "admin",
  targetType,
  targetId,
  deletionRequestId = null,
  policyKey = null,
  details = null,
  metadata = {},
} = {}) {
  const result = await client.query(
    `
    INSERT INTO compliance_events (
      event_type,
      actor_user_id,
      actor_type,
      target_type,
      target_id,
      deletion_request_id,
      policy_key,
      details,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    RETURNING *
    `,
    [
      sanitizePlainText(eventType, { maxLength: 120 }).toUpperCase(),
      actorUserId,
      actorType,
      sanitizePlainText(targetType, { maxLength: 80 }),
      sanitizePlainText(targetId, { maxLength: 160 }),
      deletionRequestId,
      policyKey,
      sanitizeOptionalText(details, { maxLength: 1000, preserveNewlines: true }),
      JSON.stringify(normalizeMetadata(metadata)),
    ]
  );

  return result.rows[0];
}

async function createDeletionRequest({
  client = pool,
  adminId,
  requestType,
  subjectType,
  subjectId,
  targetUserId = null,
  reason,
  legalHold = false,
  policyKey = null,
  metadata = {},
} = {}) {
  await assertAdmin({ client, userId: adminId });

  const normalizedRequestType = normalizeRequestType(requestType);
  const normalizedSubjectType = normalizeSubjectType(subjectType);
  const normalizedSubjectId = normalizeSubjectId(subjectId, normalizedSubjectType);
  const normalizedTargetUserId = targetUserFromSubject(
    normalizedSubjectType,
    normalizedSubjectId,
    normalizeOptionalId(targetUserId, "target user id")
  );
  const normalizedReason = sanitizePlainText(reason, {
    maxLength: 1000,
    preserveNewlines: true,
  });
  if (!normalizedReason) {
    throw withStatus("Request reason is required", 400);
  }
  const normalizedPolicyKey =
    sanitizePlainText(policyKey, { maxLength: 120 }) ||
    policyForRequestType(normalizedRequestType);

  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    [normalizedRequestType, `${normalizedSubjectType}:${normalizedSubjectId}`]
  );

  const active = await client.query(
    `
    SELECT id, status
    FROM data_deletion_requests
    WHERE request_type=$1
    AND subject_type=$2
    AND subject_id=$3
    AND status IN ('REQUESTED','UNDER_REVIEW','APPROVED')
    ORDER BY requested_at DESC, id DESC
    LIMIT 1
    `,
    [normalizedRequestType, normalizedSubjectType, normalizedSubjectId]
  );

  if (active.rows[0]) {
    throw withStatus("Active compliance request already exists", 409, {
      code: "ACTIVE_COMPLIANCE_REQUEST_EXISTS",
      activeRequest: active.rows[0],
    });
  }

  const inserted = await client.query(
    `
    INSERT INTO data_deletion_requests (
      request_type,
      subject_type,
      subject_id,
      target_user_id,
      requested_by_user_id,
      reason,
      legal_hold,
      policy_key,
      approval_snapshot
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    RETURNING *
    `,
    [
      normalizedRequestType,
      normalizedSubjectType,
      normalizedSubjectId,
      normalizedTargetUserId,
      adminId,
      normalizedReason,
      Boolean(legalHold),
      normalizedPolicyKey,
      JSON.stringify({
        created_metadata: normalizeMetadata(metadata),
        protected_domains: [
          "financial_integrity",
          "trust_replay",
          "auditability",
          "investigations",
        ],
      }),
    ]
  );
  const request = inserted.rows[0];

  await recordComplianceEvent({
    client,
    eventType: "deletion_request_created",
    actorUserId: adminId,
    targetType: request.subject_type,
    targetId: request.subject_id,
    deletionRequestId: request.id,
    policyKey: request.policy_key,
    details: request.reason,
    metadata: {
      request_type: request.request_type,
      legal_hold: request.legal_hold,
    },
  });

  return getDeletionRequestDetail({ client, requestId: request.id });
}

async function buildProtectionSnapshot({ client = pool, request }) {
  const targetUserId = request.target_user_id;
  if (!targetUserId || !isValidId(targetUserId)) {
    return {
      target_user_id: targetUserId || null,
      financial_records_required: true,
      trust_replay_required: true,
      audit_records_required: true,
      investigation_records_required: true,
      subject_type: request.subject_type,
      subject_id: request.subject_id,
    };
  }

  const row = await queryOne(
    client,
    `
    SELECT
      (SELECT COUNT(*)::int FROM financial_ledger_entries fle
        WHERE fle.actor_user_id=$1 OR fle.counterparty_user_id=$1) AS financial_ledger_links,
      (SELECT COUNT(*)::int FROM provider_settlements ps
        WHERE ps.provider_id=$1) AS provider_settlement_links,
      (SELECT COUNT(*)::int FROM payment_ownership po
        WHERE po.payer_user_id=$1 OR po.provider_id=$1 OR po.beneficiary_user_id=$1
           OR po.deposit_owner_user_id=$1 OR po.refund_target_user_id=$1
           OR po.commission_receiver_user_id=$1) AS payment_ownership_links,
      (SELECT COUNT(*)::int FROM trust_events te
        WHERE te.subject_id=$1) AS trust_event_links,
      (SELECT COUNT(*)::int FROM trust_scores ts
        WHERE ts.subject_id=$1) AS trust_score_links,
      (SELECT COUNT(*)::int FROM provider_reports pr
        WHERE pr.provider_id=$1 OR pr.reported_by=$1) AS provider_report_links,
      (SELECT COUNT(*)::int FROM moderation_appeals ma
        WHERE ma.provider_id=$1 OR ma.withdrawn_by_user_id=$1 OR ma.reviewed_by_admin=$1) AS appeal_links,
      (SELECT COUNT(*)::int FROM incident_events ie
        WHERE ie.actor_user_id=$1 OR ie.from_assigned_admin_id=$1 OR ie.to_assigned_admin_id=$1) AS incident_event_links,
      (SELECT COUNT(*)::int FROM notifications n
        WHERE n.user_id=$1) AS notification_links,
      (SELECT COUNT(*)::int FROM provider_report_attachments pra
        WHERE pra.uploader_user_id=$1) AS provider_evidence_links,
      (SELECT COUNT(*)::int FROM moderation_appeal_attachments maa
        WHERE maa.uploader_user_id=$1) AS appeal_evidence_links
    `,
    [targetUserId]
  );

  return {
    target_user_id: targetUserId,
    financial_ledger_links: toInt(row.financial_ledger_links),
    provider_settlement_links: toInt(row.provider_settlement_links),
    payment_ownership_links: toInt(row.payment_ownership_links),
    trust_event_links: toInt(row.trust_event_links),
    trust_score_links: toInt(row.trust_score_links),
    provider_report_links: toInt(row.provider_report_links),
    appeal_links: toInt(row.appeal_links),
    incident_event_links: toInt(row.incident_event_links),
    notification_links: toInt(row.notification_links),
    provider_evidence_links: toInt(row.provider_evidence_links),
    appeal_evidence_links: toInt(row.appeal_evidence_links),
    financial_records_required: true,
    trust_replay_required: true,
    audit_records_required: true,
    investigation_records_required: true,
    execution_mode: "anonymize_or_archive_only",
  };
}

async function lockDeletionRequest({ client, requestId }) {
  const result = await client.query(
    deletionRequestSelect("WHERE ddr.id=$1", "LIMIT 1 FOR UPDATE OF ddr"),
    [requestId]
  );
  return result.rows[0] || null;
}

function assertTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    throw withStatus("Compliance request is already in that status", 409);
  }
  if (!STATUS_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw withStatus(
      `Compliance request cannot transition from ${currentStatus} to ${nextStatus}`,
      409
    );
  }
}

async function transitionDeletionRequest({
  client = pool,
  requestId,
  adminId,
  status,
  note = null,
} = {}) {
  await assertAdmin({ client, userId: adminId });
  if (!isValidId(requestId)) {
    throw withStatus("Deletion request id is required", 400);
  }
  const nextStatus = normalizeStatus(status);
  if (!nextStatus) {
    throw withStatus("Next request status is required", 400);
  }
  const request = await lockDeletionRequest({ client, requestId });
  if (!request) return null;

  assertTransition(request.status, nextStatus);

  const sanitizedNote = sanitizeOptionalText(note, {
    maxLength: 1000,
    preserveNewlines: true,
  });
  const approvalSnapshot =
    nextStatus === "APPROVED"
      ? await buildProtectionSnapshot({ client, request })
      : request.approval_snapshot || {};

  const result = await client.query(
    `
    UPDATE data_deletion_requests
    SET status=$2,
        review_note=CASE WHEN $2='UNDER_REVIEW' THEN $3 ELSE review_note END,
        decision_note=CASE WHEN $2 IN ('APPROVED','REJECTED','CANCELLED') THEN $3 ELSE decision_note END,
        reviewed_by_admin_id=CASE WHEN $2 IN ('UNDER_REVIEW','REJECTED') THEN $4 ELSE reviewed_by_admin_id END,
        reviewed_at=CASE WHEN $2 IN ('UNDER_REVIEW','REJECTED') THEN NOW() ELSE reviewed_at END,
        approved_by_admin_id=CASE WHEN $2='APPROVED' THEN $4 ELSE approved_by_admin_id END,
        approved_at=CASE WHEN $2='APPROVED' THEN NOW() ELSE approved_at END,
        approval_snapshot=$5::jsonb,
        updated_at=NOW()
    WHERE id=$1
    RETURNING *
    `,
    [
      requestId,
      nextStatus,
      sanitizedNote,
      adminId,
      JSON.stringify(approvalSnapshot),
    ]
  );
  const updated = result.rows[0];

  await recordComplianceEvent({
    client,
    eventType: `deletion_request_${nextStatus.toLowerCase()}`,
    actorUserId: adminId,
    targetType: updated.subject_type,
    targetId: updated.subject_id,
    deletionRequestId: updated.id,
    policyKey: updated.policy_key,
    details: sanitizedNote,
    metadata: {
      from_status: request.status,
      to_status: nextStatus,
      approval_snapshot: nextStatus === "APPROVED" ? approvalSnapshot : undefined,
    },
  });

  return getDeletionRequestDetail({ client, requestId });
}

async function executeAccountAnonymization({ client, request, adminId }) {
  const userId = request.target_user_id;
  if (!userId || !isValidId(userId)) {
    throw withStatus("Target user id is required for account anonymization", 400);
  }
  if (request.subject_type === "admin") {
    throw withStatus("Admin accounts cannot be anonymized through this workflow", 409);
  }

  const replacementName = `Deleted user ${String(userId).slice(0, 8)}`;
  const replacementPhone = `deleted${String(userId).replace(/-/g, "").slice(0, 8)}`;

  const userResult = await client.query(
    `
    UPDATE users
    SET name=$2,
        phone=$3,
        email=NULL,
        profile_image=NULL,
        fcm_token=NULL,
        address=NULL,
        latitude=NULL,
        longitude=NULL,
        location=NULL,
        refresh_token=NULL,
        refresh_token_expiry=NULL,
        refresh_token_family=NULL,
        refresh_token_device=NULL,
        refresh_token_last_used_at=NULL,
        last_auth_activity_at=NOW(),
        is_available=false
    WHERE id=$1
    RETURNING id, role
    `,
    [userId, replacementName, replacementPhone]
  );

  if (!userResult.rows[0]) {
    throw withStatus("Target user not found", 404);
  }

  const restaurants = await client.query(
    `
    UPDATE restaurants
    SET restaurant_name='Anonymized provider',
        fssai_number=NULL,
        fssai_certificate_url=NULL,
        latitude=NULL,
        longitude=NULL,
        location=NULL
    WHERE user_id=$1
    RETURNING id
    `,
    [userId]
  );

  const ngos = await client.query(
    `
    UPDATE ngos
    SET organization_name='Anonymized NGO',
        registration_number=NULL,
        latitude=NULL,
        longitude=NULL,
        location=NULL
    WHERE user_id=$1
    RETURNING id
    `,
    [userId]
  );

  const notificationArchive = await archiveNotificationsForUser({
    client,
    userId,
    adminId,
    reason: "Account anonymization request",
  });

  return {
    mode: "anonymization",
    user_id: userId,
    role: userResult.rows[0].role,
    user_contact_fields_anonymized: true,
    restaurants_anonymized: restaurants.rowCount,
    ngos_anonymized: ngos.rowCount,
    notifications_archived: notificationArchive.archived_count,
    preserved: [
      "user_id",
      "financial_records",
      "trust_replay_records",
      "audit_records",
      "moderation_history",
      "incident_history",
    ],
  };
}

async function buildDataAccessSummary({ client, request }) {
  const snapshot = await buildProtectionSnapshot({ client, request });
  return {
    mode: "data_access_summary",
    subject_type: request.subject_type,
    subject_id: request.subject_id,
    target_user_id: request.target_user_id || null,
    available_domains: [
      "profile",
      "notifications",
      "reservations",
      "financial_references",
      "trust_replay_references",
      "governance_references",
      "incident_references",
    ],
    protection_snapshot: snapshot,
    export_generated: false,
  };
}

async function archiveNotificationsForUser({
  client,
  userId,
  adminId,
  reason = "Compliance notification archive",
} = {}) {
  const result = await client.query(
    `
    UPDATE notifications
    SET archive_status='archived',
        archived_at=COALESCE(archived_at, NOW()),
        archived_by_admin_id=$2,
        archive_metadata=archive_metadata || $3::jsonb
    WHERE user_id=$1
    AND archive_status <> 'archived'
    RETURNING id
    `,
    [
      userId,
      adminId,
      JSON.stringify({
        reason,
        archived_by: "compliance_workflow",
      }),
    ]
  );

  return {
    mode: "notification_archive",
    user_id: userId,
    archived_count: result.rowCount,
  };
}

async function archiveNotificationById({ client, notificationId, adminId }) {
  const result = await client.query(
    `
    UPDATE notifications
    SET archive_status='archived',
        archived_at=COALESCE(archived_at, NOW()),
        archived_by_admin_id=$2,
        archive_metadata=archive_metadata || $3::jsonb
    WHERE id=$1
    RETURNING id, user_id, type, created_at
    `,
    [
      notificationId,
      adminId,
      JSON.stringify({
        reason: "Compliance notification archive",
        archived_by: "compliance_workflow",
      }),
    ]
  );

  return {
    mode: "notification_archive",
    notification_id: notificationId,
    archived_count: result.rowCount,
    notification: result.rows[0] || null,
  };
}

function cloudinaryArchiveReference(fileUrl) {
  if (!fileUrl) return null;
  return String(fileUrl).slice(0, 500);
}

async function markEvidenceArchived({
  client = pool,
  adminId,
  evidenceType,
  evidenceId,
  reason = "Compliance archive",
  deletionRequestId = null,
} = {}) {
  await assertAdmin({ client, userId: adminId });
  const normalizedEvidenceType = normalizeEvidenceType(evidenceType);
  const normalizedEvidenceId = normalizeSubjectId(
    evidenceId,
    normalizedEvidenceType
  );
  const config = EVIDENCE_TABLES[normalizedEvidenceType];
  const sanitizedReason = sanitizeOptionalText(reason, {
    maxLength: 1000,
    preserveNewlines: true,
  });

  const current = await queryOne(
    client,
    `
    SELECT id, ${config.parentColumn} AS parent_id, file_url, mime_type, file_size_bytes,
           archive_status, archive_reference, retention_policy_key
    FROM ${config.table}
    WHERE ${config.idColumn}=$1
    `,
    [normalizedEvidenceId]
  );

  if (!current.id) {
    throw withStatus("Evidence record not found", 404);
  }

  const archiveReference =
    current.archive_reference || cloudinaryArchiveReference(current.file_url);
  const metadata = {
    reason: sanitizedReason,
    storage_provider: "cloudinary",
    preserved_file_url: true,
    parent_id: current.parent_id,
    mime_type: current.mime_type,
    file_size_bytes: current.file_size_bytes,
  };

  const updated = await client.query(
    `
    UPDATE ${config.table}
    SET archive_status='archived',
        archived_at=COALESCE(archived_at, NOW()),
        archived_by_admin_id=$2,
        archive_reference=$3,
        archive_metadata=archive_metadata || $4::jsonb
    WHERE ${config.idColumn}=$1
    RETURNING *
    `,
    [
      normalizedEvidenceId,
      adminId,
      archiveReference,
      JSON.stringify(metadata),
    ]
  );

  await client.query(
    `
    INSERT INTO data_archive_records (
      source_table,
      source_record_id,
      policy_key,
      archive_status,
      archive_reason,
      storage_provider,
      archive_reference,
      archived_by_admin_id,
      archived_at,
      metadata
    )
    VALUES ($1,$2,'evidence_records','archived',$3,'cloudinary',$4,$5,NOW(),$6::jsonb)
    ON CONFLICT (source_table, source_record_id)
    DO UPDATE SET
      archive_status='archived',
      archive_reason=EXCLUDED.archive_reason,
      storage_provider='cloudinary',
      archive_reference=EXCLUDED.archive_reference,
      archived_by_admin_id=EXCLUDED.archived_by_admin_id,
      archived_at=COALESCE(data_archive_records.archived_at, NOW()),
      metadata=data_archive_records.metadata || EXCLUDED.metadata,
      updated_at=NOW()
    `,
    [
      config.table,
      normalizedEvidenceId,
      sanitizedReason,
      archiveReference,
      adminId,
      JSON.stringify(metadata),
    ]
  );

  await recordComplianceEvent({
    client,
    eventType: "evidence_archived",
    actorUserId: adminId,
    targetType: config.targetType,
    targetId: normalizedEvidenceId,
    deletionRequestId,
    policyKey: "evidence_records",
    details: sanitizedReason,
    metadata,
  });

  return {
    mode: "evidence_archive",
    evidence_type: normalizedEvidenceType,
    evidence_id: normalizedEvidenceId,
    record: updated.rows[0],
    cloudinary_reference_preserved: true,
    physical_delete_performed: false,
  };
}

async function executeEvidenceRetention({ client, request, adminId }) {
  if (!EVIDENCE_TABLES[request.subject_type]) {
    throw withStatus("Evidence request subject is not an evidence record", 400);
  }

  return markEvidenceArchived({
    client,
    adminId,
    evidenceType: request.subject_type,
    evidenceId: request.subject_id,
    reason: request.reason,
    deletionRequestId: request.id,
  });
}

async function executeNotificationCleanup({ client, request, adminId }) {
  if (request.subject_type === "notification") {
    return archiveNotificationById({
      client,
      notificationId: request.subject_id,
      adminId,
    });
  }

  if (!request.target_user_id) {
    throw withStatus("Target user is required for notification cleanup", 400);
  }

  return archiveNotificationsForUser({
    client,
    userId: request.target_user_id,
    adminId,
    reason: request.reason,
  });
}

async function executeDeletionRequest({
  client = pool,
  requestId,
  adminId,
  note = null,
} = {}) {
  await assertAdmin({ client, userId: adminId });
  if (!isValidId(requestId)) {
    throw withStatus("Deletion request id is required", 400);
  }

  const request = await lockDeletionRequest({ client, requestId });
  if (!request) return null;
  assertTransition(request.status, "EXECUTED");
  if (request.legal_hold) {
    throw withStatus("Request is under legal hold and cannot be executed", 409);
  }

  let executionResult;
  if (request.request_type === "account_deletion" || request.request_type === "anonymization") {
    executionResult = await executeAccountAnonymization({ client, request, adminId });
  } else if (request.request_type === "data_access") {
    executionResult = await buildDataAccessSummary({ client, request });
  } else if (request.request_type === "evidence_deletion") {
    executionResult = await executeEvidenceRetention({ client, request, adminId });
  } else if (request.request_type === "notification_cleanup") {
    executionResult = await executeNotificationCleanup({ client, request, adminId });
  } else {
    throw withStatus("Unsupported request type", 400);
  }

  const sanitizedNote = sanitizeOptionalText(note, {
    maxLength: 1000,
    preserveNewlines: true,
  });
  const summary = sanitizedNote || `${request.request_type} executed via ${executionResult.mode}`;

  await client.query(
    `
    UPDATE data_deletion_requests
    SET status='EXECUTED',
        execution_summary=$2,
        execution_result=$3::jsonb,
        executed_by_admin_id=$4,
        executed_at=NOW(),
        updated_at=NOW()
    WHERE id=$1
    `,
    [requestId, summary, JSON.stringify(executionResult), adminId]
  );

  await recordComplianceEvent({
    client,
    eventType: "deletion_request_executed",
    actorUserId: adminId,
    targetType: request.subject_type,
    targetId: request.subject_id,
    deletionRequestId: request.id,
    policyKey: request.policy_key,
    details: summary,
    metadata: executionResult,
  });

  return getDeletionRequestDetail({ client, requestId });
}

module.exports = {
  ACTIVE_REQUEST_STATUSES,
  ANALYSIS,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  SUBJECT_TYPES,
  archiveNotificationsForUser,
  createDeletionRequest,
  executeDeletionRequest,
  getComplianceDashboard,
  getDeletionRequestDetail,
  getEvidenceInventory,
  getFinancialRetentionStatus,
  getRetentionPolicies,
  getTrustRetentionStatus,
  listDeletionRequests,
  markEvidenceArchived,
  recordComplianceEvent,
  transitionDeletionRequest,
};
