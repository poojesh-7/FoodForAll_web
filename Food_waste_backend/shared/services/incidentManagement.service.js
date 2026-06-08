const pool = require("../config/db");
const { assertAdmin } = require("./authorization.service");
const {
  sanitizeOptionalText,
  sanitizePlainText,
} = require("../utils/sanitize");
const { isValidId } = require("../../utils/validation");

const INCIDENT_STATUSES = new Set([
  "OPEN",
  "INVESTIGATING",
  "IDENTIFIED",
  "MITIGATING",
  "RESOLVED",
  "CLOSED",
]);

const INCIDENT_SEVERITIES = new Set(["SEV1", "SEV2", "SEV3", "SEV4"]);
const INCIDENT_CATEGORIES = new Set([
  "INFRASTRUCTURE",
  "PAYMENTS",
  "TRUST",
  "GOVERNANCE",
  "NOTIFICATIONS",
  "REALTIME",
  "DATABASE",
  "SECURITY",
  "COMPLIANCE",
  "OTHER",
]);

const INCIDENT_SOURCE_TYPES = new Set([
  "manual",
  "operational_monitoring",
  "operational_alert",
  "queue_diagnostic",
  "trust_diagnostic",
  "financial_diagnostic",
]);

const STATUS_TRANSITIONS = {
  OPEN: new Set(["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"]),
  INVESTIGATING: new Set(["IDENTIFIED", "MITIGATING", "RESOLVED"]),
  IDENTIFIED: new Set(["MITIGATING", "RESOLVED"]),
  MITIGATING: new Set(["RESOLVED"]),
  RESOLVED: new Set(["CLOSED"]),
  CLOSED: new Set(),
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const ANALYSIS = {
  architecture: [
    "Incident Management is an operational response ledger layered beside existing monitoring, diagnostics, and Audit Center surfaces.",
    "Incident records are immutable; current status and assignment are derived from append-only incident_events.",
    "The service records incident response only and never retries queues, changes payment state, modifies trust state, or performs enforcement actions.",
    "Audit Center consumes incident_events as a read-only source, preserving lineage back to incident_records and optional diagnostic source context.",
  ],
  gaps: [
    "Existing monitoring alerts and diagnostics are read models, so incident source context stores a snapshot/reference rather than owning those systems.",
    "Duplicate detection is intentionally advisory because related operational symptoms can require separate response tracks.",
    "Postmortem completeness is enforced at submission time, but follow-up ownership remains operational process data rather than a task system.",
  ],
  reuse: [
    "Operational Monitoring: manual incident source references can capture derived or persisted alerts.",
    "Queue Diagnostics: queue name, job id, failed reason, and worker heartbeat context can be stored as source_context.",
    "Trust Explainability and diagnostics: subject id, processing state, and projection details can be stored without altering trust formulas.",
    "Financial diagnostics: payment, webhook, settlement, and reconciliation context can be referenced without mutating financial workflows.",
    "Audit Center: incident_events joins the existing read-only audit timeline model.",
  ],
  risks: [
    "Incident duplication is possible when multiple admins open related incidents; source_ref_id and search make duplicates discoverable without blocking legitimate parallel response.",
    "Assignment conflicts are serialized by row locks and latest assignment events; the timeline keeps every assignment change visible.",
    "Timeline integrity depends on immutable event, note, postmortem, and record tables with database triggers.",
    "Postmortems can become stale if operational follow-up changes outside this system; immutable postmortems preserve the accepted record at submission time.",
  ],
  schemaChanges: [
    "Migration 023 adds incident_records, incident_events, incident_notes, and incident_postmortems.",
    "All incident management tables have update/delete immutability triggers.",
    "No validated trust, financial, moderation, appeals, queue recovery, or notification tables are changed.",
  ],
};

function withStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeStatus(status) {
  const normalized = sanitizePlainText(status, { maxLength: 40 }).toUpperCase();
  if (!INCIDENT_STATUSES.has(normalized)) {
    throw withStatus("Invalid incident status", 400);
  }
  return normalized;
}

function normalizeSeverity(severity) {
  const normalized = sanitizePlainText(severity, { maxLength: 20 }).toUpperCase();
  if (!INCIDENT_SEVERITIES.has(normalized)) {
    throw withStatus("Invalid incident severity", 400);
  }
  return normalized;
}

function normalizeCategory(category) {
  const normalized = sanitizePlainText(category, { maxLength: 60 }).toUpperCase();
  if (!INCIDENT_CATEGORIES.has(normalized)) {
    throw withStatus("Invalid incident category", 400);
  }
  return normalized;
}

function normalizeSourceType(sourceType) {
  const normalized = sanitizePlainText(sourceType || "manual", {
    maxLength: 80,
  }).toLowerCase();
  if (!INCIDENT_SOURCE_TYPES.has(normalized)) {
    throw withStatus("Invalid incident source type", 400);
  }
  return normalized;
}

function normalizeText(value, options = {}) {
  return sanitizePlainText(value, options);
}

function normalizeOptionalText(value, options = {}) {
  return sanitizeOptionalText(value, options);
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

function normalizeLimit(value) {
  return Math.max(1, Math.min(toInt(value, DEFAULT_LIMIT), MAX_LIMIT));
}

function assertTransitionAllowed(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    throw withStatus("Incident is already in that status", 409);
  }

  if (!STATUS_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw withStatus(
      `Incident cannot transition from ${currentStatus} to ${nextStatus}`,
      409
    );
  }
}

async function assertAssignableAdmin({ client, adminId }) {
  if (!adminId) return null;
  await assertAdmin({ client, userId: adminId });
  return adminId;
}

function incidentStateCte({ whereSql = "", forUpdate = false } = {}) {
  return `
    WITH incident_state AS (
      SELECT
        ir.id,
        ir.title,
        ir.description,
        ir.severity,
        ir.category,
        ir.initial_status,
        ir.created_by_admin_id,
        created_by.name AS created_by_admin_name,
        ir.source_type,
        ir.source_ref_id,
        ir.source_context,
        ir.created_at,
        COALESCE(status_event.to_status, ir.initial_status) AS status,
        assignment_event.to_assigned_admin_id AS assigned_admin_id,
        assigned_admin.name AS assigned_admin_name,
        resolved_event.actor_user_id AS resolved_by_admin_id,
        resolved_by.name AS resolved_by_admin_name,
        resolved_event.created_at AS resolved_at,
        closed_event.actor_user_id AS closed_by_admin_id,
        closed_by.name AS closed_by_admin_name,
        closed_event.created_at AS closed_at,
        COALESCE(note_counts.note_count, 0)::int AS note_count,
        postmortem.id AS postmortem_id,
        postmortem.created_at AS postmortem_created_at
      FROM incident_records ir
      LEFT JOIN users created_by ON created_by.id = ir.created_by_admin_id
      LEFT JOIN LATERAL (
        SELECT ie.to_status, ie.created_at, ie.id
        FROM incident_events ie
        WHERE ie.incident_id = ir.id
        AND ie.to_status IS NOT NULL
        ORDER BY ie.created_at DESC, ie.id DESC
        LIMIT 1
      ) status_event ON true
      LEFT JOIN LATERAL (
        SELECT ie.to_assigned_admin_id, ie.created_at, ie.id
        FROM incident_events ie
        WHERE ie.incident_id = ir.id
        AND ie.event_type IN ('INCIDENT_CREATED','INCIDENT_ASSIGNED')
        ORDER BY ie.created_at DESC, ie.id DESC
        LIMIT 1
      ) assignment_event ON true
      LEFT JOIN users assigned_admin ON assigned_admin.id = assignment_event.to_assigned_admin_id
      LEFT JOIN LATERAL (
        SELECT ie.actor_user_id, ie.created_at
        FROM incident_events ie
        WHERE ie.incident_id = ir.id
        AND ie.event_type = 'INCIDENT_RESOLVED'
        ORDER BY ie.created_at DESC, ie.id DESC
        LIMIT 1
      ) resolved_event ON true
      LEFT JOIN users resolved_by ON resolved_by.id = resolved_event.actor_user_id
      LEFT JOIN LATERAL (
        SELECT ie.actor_user_id, ie.created_at
        FROM incident_events ie
        WHERE ie.incident_id = ir.id
        AND ie.event_type = 'INCIDENT_CLOSED'
        ORDER BY ie.created_at DESC, ie.id DESC
        LIMIT 1
      ) closed_event ON true
      LEFT JOIN users closed_by ON closed_by.id = closed_event.actor_user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS note_count
        FROM incident_notes note
        WHERE note.incident_id = ir.id
      ) note_counts ON true
      LEFT JOIN incident_postmortems postmortem ON postmortem.incident_id = ir.id
      ${whereSql}
      ${forUpdate ? "FOR UPDATE OF ir" : ""}
    )
  `;
}

function normalizeIncidentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || null,
    severity: row.severity,
    category: row.category,
    status: row.status,
    created_by_admin_id: row.created_by_admin_id,
    created_by_admin_name: row.created_by_admin_name || null,
    assigned_admin_id: row.assigned_admin_id || null,
    assigned_admin_name: row.assigned_admin_name || null,
    resolved_by_admin_id: row.resolved_by_admin_id || null,
    resolved_by_admin_name: row.resolved_by_admin_name || null,
    closed_by_admin_id: row.closed_by_admin_id || null,
    closed_by_admin_name: row.closed_by_admin_name || null,
    source_type: row.source_type,
    source_ref_id: row.source_ref_id || null,
    source_context: row.source_context || {},
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
    closed_at: row.closed_at || null,
    note_count: toInt(row.note_count),
    postmortem_id: row.postmortem_id || null,
    postmortem_created_at: row.postmortem_created_at || null,
  };
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function filtersForList(options = {}) {
  return {
    status: options.status ? normalizeStatus(options.status) : null,
    severity: options.severity ? normalizeSeverity(options.severity) : null,
    category: options.category ? normalizeCategory(options.category) : null,
    assignedAdminId:
      options.assignedAdminId || options.assigned_admin_id
        ? String(options.assignedAdminId || options.assigned_admin_id).trim()
        : null,
    search: sanitizeOptionalText(options.q || options.search, { maxLength: 160 }),
    limit: normalizeLimit(options.limit),
  };
}

function buildIncidentListWhere(filters, params) {
  const where = [];

  if (filters.status) {
    where.push(`status = ${addParam(params, filters.status)}`);
  }

  if (filters.severity) {
    where.push(`severity = ${addParam(params, filters.severity)}`);
  }

  if (filters.category) {
    where.push(`category = ${addParam(params, filters.category)}`);
  }

  if (filters.assignedAdminId) {
    if (filters.assignedAdminId === "unassigned") {
      where.push("assigned_admin_id IS NULL");
    } else {
      where.push(`assigned_admin_id = ${addParam(params, normalizeOptionalId(filters.assignedAdminId, "assigned admin id"))}::uuid`);
    }
  }

  if (filters.search) {
    const searchParam = addParam(params, filters.search.toLowerCase());
    where.push(`(
      LOWER(id::text) LIKE '%' || ${searchParam} || '%'
      OR LOWER(title) LIKE '%' || ${searchParam} || '%'
      OR LOWER(COALESCE(source_ref_id, '')) LIKE '%' || ${searchParam} || '%'
    )`);
  }

  return where.length ? `WHERE ${where.join("\n      AND ")}` : "";
}

async function getIncidentState({ client = pool, incidentId, forUpdate = false }) {
  if (!isValidId(incidentId)) {
    throw withStatus("Incident id is required", 400);
  }

  const result = await client.query(
    `
    ${incidentStateCte({ whereSql: "WHERE ir.id=$1", forUpdate })}
    SELECT *
    FROM incident_state
    LIMIT 1
    `,
    [incidentId]
  );

  return normalizeIncidentRow(result.rows[0]);
}

async function getIncidentEvents({ client = pool, incidentId }) {
  const result = await client.query(
    `
    SELECT ie.id,
           ie.incident_id,
           ie.actor_user_id,
           actor.name AS actor_name,
           actor.role AS actor_role,
           ie.event_type,
           ie.from_status,
           ie.to_status,
           ie.from_assigned_admin_id,
           from_admin.name AS from_assigned_admin_name,
           ie.to_assigned_admin_id,
           to_admin.name AS to_assigned_admin_name,
           ie.note_id,
           ie.postmortem_id,
           ie.details,
           ie.metadata,
           ie.created_at
    FROM incident_events ie
    LEFT JOIN users actor ON actor.id = ie.actor_user_id
    LEFT JOIN users from_admin ON from_admin.id = ie.from_assigned_admin_id
    LEFT JOIN users to_admin ON to_admin.id = ie.to_assigned_admin_id
    WHERE ie.incident_id=$1
    ORDER BY ie.created_at ASC, ie.id ASC
    `,
    [incidentId]
  );

  return result.rows;
}

async function getIncidentNotes({ client = pool, incidentId }) {
  const result = await client.query(
    `
    SELECT note.id,
           note.incident_id,
           note.admin_user_id,
           admin.name AS admin_name,
           note.note,
           note.metadata,
           note.created_at
    FROM incident_notes note
    LEFT JOIN users admin ON admin.id = note.admin_user_id
    WHERE note.incident_id=$1
    ORDER BY note.created_at ASC, note.id ASC
    `,
    [incidentId]
  );

  return result.rows;
}

async function getIncidentPostmortem({ client = pool, incidentId }) {
  const result = await client.query(
    `
    SELECT pm.id,
           pm.incident_id,
           pm.admin_user_id,
           admin.name AS admin_name,
           pm.root_cause,
           pm.impact_summary,
           pm.detection_method,
           pm.resolution_summary,
           pm.follow_up_actions,
           pm.metadata,
           pm.created_at
    FROM incident_postmortems pm
    LEFT JOIN users admin ON admin.id = pm.admin_user_id
    WHERE pm.incident_id=$1
    LIMIT 1
    `,
    [incidentId]
  );

  return result.rows[0] || null;
}

async function getIncidentDetail({ client = pool, incidentId }) {
  const incident = await getIncidentState({ client, incidentId });
  if (!incident) return null;

  const [events, notes, postmortem] = await Promise.all([
    getIncidentEvents({ client, incidentId }),
    getIncidentNotes({ client, incidentId }),
    getIncidentPostmortem({ client, incidentId }),
  ]);

  return {
    incident,
    timeline: events,
    events,
    notes,
    postmortem,
    analysis: ANALYSIS,
  };
}

async function getIncidentSummary({ client = pool, adminId }) {
  const result = await client.query(
    `
    ${incidentStateCte()}
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED'))::int AS open_incidents,
      COUNT(*) FILTER (
        WHERE status NOT IN ('RESOLVED','CLOSED')
        AND severity='SEV1'
      )::int AS critical_incidents,
      COUNT(*) FILTER (
        WHERE status IN ('RESOLVED','CLOSED')
        AND resolved_at >= NOW() - INTERVAL '7 days'
      )::int AS recently_resolved_incidents,
      COUNT(*) FILTER (
        WHERE assigned_admin_id=$1
        AND status NOT IN ('RESOLVED','CLOSED')
      )::int AS assigned_to_me
    FROM incident_state
    `,
    [adminId]
  );

  return result.rows[0] || {
    open_incidents: 0,
    critical_incidents: 0,
    recently_resolved_incidents: 0,
    assigned_to_me: 0,
  };
}

async function getIncidentReporting({ client = pool }) {
  const [mttr, bySeverity, byCategory] = await Promise.all([
    client.query(`
      ${incidentStateCte()}
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))))::int AS mttr_seconds,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved_count
      FROM incident_state
      WHERE resolved_at IS NOT NULL
    `),
    client.query(`
      ${incidentStateCte()}
      SELECT severity, COUNT(*)::int AS count
      FROM incident_state
      GROUP BY severity
      ORDER BY severity ASC
    `),
    client.query(`
      ${incidentStateCte()}
      SELECT category, COUNT(*)::int AS count
      FROM incident_state
      GROUP BY category
      ORDER BY count DESC, category ASC
    `),
  ]);

  return {
    mttr_seconds: toInt(mttr.rows[0]?.mttr_seconds),
    resolved_count: toInt(mttr.rows[0]?.resolved_count),
    by_severity: bySeverity.rows,
    by_category: byCategory.rows,
  };
}

async function listIncidents({ client = pool, adminId, filters = {} } = {}) {
  const normalizedFilters = filtersForList(filters);
  const params = [];
  const whereSql = buildIncidentListWhere(normalizedFilters, params);
  const limitParam = addParam(params, normalizedFilters.limit);

  const [incidents, summary, reporting] = await Promise.all([
    client.query(
      `
      ${incidentStateCte()}
      SELECT *
      FROM incident_state
      ${whereSql}
      ORDER BY
        CASE status
          WHEN 'OPEN' THEN 0
          WHEN 'INVESTIGATING' THEN 1
          WHEN 'IDENTIFIED' THEN 2
          WHEN 'MITIGATING' THEN 3
          WHEN 'RESOLVED' THEN 4
          ELSE 5
        END,
        CASE severity
          WHEN 'SEV1' THEN 0
          WHEN 'SEV2' THEN 1
          WHEN 'SEV3' THEN 2
          ELSE 3
        END,
        created_at DESC,
        id DESC
      LIMIT ${limitParam}
      `,
      params
    ),
    getIncidentSummary({ client, adminId }),
    getIncidentReporting({ client }),
  ]);

  return {
    generated_at: new Date().toISOString(),
    filters: {
      status: normalizedFilters.status,
      severity: normalizedFilters.severity,
      category: normalizedFilters.category,
      assigned_admin_id: normalizedFilters.assignedAdminId,
      q: normalizedFilters.search,
      limit: normalizedFilters.limit,
    },
    incidents: incidents.rows.map(normalizeIncidentRow),
    summary,
    reporting,
    analysis: ANALYSIS,
  };
}

async function createIncident({
  client = pool,
  adminId,
  title,
  description = null,
  severity,
  category,
  assignedAdminId = null,
  sourceType = "manual",
  sourceRefId = null,
  sourceContext = {},
} = {}) {
  await assertAdmin({ client, userId: adminId });

  const normalizedTitle = normalizeText(title, { maxLength: 160 });
  if (!normalizedTitle) {
    throw withStatus("Incident title is required", 400);
  }

  const normalizedAssignedAdminId = normalizeOptionalId(
    assignedAdminId,
    "assigned admin id"
  );
  await assertAssignableAdmin({ client, adminId: normalizedAssignedAdminId });

  const incidentResult = await client.query(
    `
    INSERT INTO incident_records (
      title,
      description,
      severity,
      category,
      created_by_admin_id,
      source_type,
      source_ref_id,
      source_context
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    RETURNING *
    `,
    [
      normalizedTitle,
      normalizeOptionalText(description, {
        maxLength: 2000,
        preserveNewlines: true,
      }),
      normalizeSeverity(severity),
      normalizeCategory(category),
      adminId,
      normalizeSourceType(sourceType),
      normalizeOptionalText(sourceRefId, { maxLength: 160 }),
      JSON.stringify(normalizeMetadata(sourceContext, "source context")),
    ]
  );
  const incident = incidentResult.rows[0];

  await client.query(
    `
    INSERT INTO incident_events (
      incident_id,
      actor_user_id,
      event_type,
      to_status,
      to_assigned_admin_id,
      details,
      metadata
    )
    VALUES ($1,$2,'INCIDENT_CREATED','OPEN',$3,$4,$5::jsonb)
    `,
    [
      incident.id,
      adminId,
      normalizedAssignedAdminId,
      "Incident created",
      JSON.stringify({
        source_type: incident.source_type,
        source_ref_id: incident.source_ref_id,
      }),
    ]
  );

  if (normalizedAssignedAdminId) {
    await client.query(
      `
      INSERT INTO incident_events (
        incident_id,
        actor_user_id,
        event_type,
        to_assigned_admin_id,
        details,
        metadata
      )
      VALUES ($1,$2,'INCIDENT_ASSIGNED',$3,$4,$5::jsonb)
      `,
      [
        incident.id,
        adminId,
        normalizedAssignedAdminId,
        "Incident assigned during creation",
        JSON.stringify({ assignment_source: "incident_creation" }),
      ]
    );
  }

  return getIncidentDetail({ client, incidentId: incident.id });
}

async function transitionIncidentStatus({
  client = pool,
  incidentId,
  adminId,
  status,
  note = null,
} = {}) {
  await assertAdmin({ client, userId: adminId });
  const nextStatus = normalizeStatus(status);
  const incident = await getIncidentState({ client, incidentId, forUpdate: true });
  if (!incident) return null;

  assertTransitionAllowed(incident.status, nextStatus);

  const eventType =
    nextStatus === "RESOLVED"
      ? "INCIDENT_RESOLVED"
      : nextStatus === "CLOSED"
        ? "INCIDENT_CLOSED"
        : "INCIDENT_STATUS_CHANGED";
  const details = normalizeOptionalText(note, {
    maxLength: 1000,
    preserveNewlines: true,
  });

  await client.query(
    `
    INSERT INTO incident_events (
      incident_id,
      actor_user_id,
      event_type,
      from_status,
      to_status,
      details,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    `,
    [
      incidentId,
      adminId,
      eventType,
      incident.status,
      nextStatus,
      details,
      JSON.stringify({
        previous_status: incident.status,
        next_status: nextStatus,
      }),
    ]
  );

  return getIncidentDetail({ client, incidentId });
}

async function assignIncident({
  client = pool,
  incidentId,
  adminId,
  assignedAdminId = null,
  note = null,
} = {}) {
  await assertAdmin({ client, userId: adminId });
  const incident = await getIncidentState({ client, incidentId, forUpdate: true });
  if (!incident) return null;
  if (incident.status === "CLOSED") {
    throw withStatus("Closed incidents cannot be reassigned", 409);
  }

  const normalizedAssignedAdminId = normalizeOptionalId(
    assignedAdminId,
    "assigned admin id"
  );
  await assertAssignableAdmin({ client, adminId: normalizedAssignedAdminId });

  if (String(incident.assigned_admin_id || "") === String(normalizedAssignedAdminId || "")) {
    throw withStatus("Incident assignment is unchanged", 409);
  }

  await client.query(
    `
    INSERT INTO incident_events (
      incident_id,
      actor_user_id,
      event_type,
      from_assigned_admin_id,
      to_assigned_admin_id,
      details,
      metadata
    )
    VALUES ($1,$2,'INCIDENT_ASSIGNED',$3,$4,$5,$6::jsonb)
    `,
    [
      incidentId,
      adminId,
      incident.assigned_admin_id,
      normalizedAssignedAdminId,
      normalizeOptionalText(note, {
        maxLength: 1000,
        preserveNewlines: true,
      }),
      JSON.stringify({
        previous_assigned_admin_id: incident.assigned_admin_id,
        next_assigned_admin_id: normalizedAssignedAdminId,
      }),
    ]
  );

  return getIncidentDetail({ client, incidentId });
}

async function addIncidentNote({
  client = pool,
  incidentId,
  adminId,
  note,
  metadata = {},
} = {}) {
  await assertAdmin({ client, userId: adminId });
  const incident = await getIncidentState({ client, incidentId, forUpdate: true });
  if (!incident) return null;

  const sanitizedNote = normalizeText(note, {
    maxLength: 3000,
    preserveNewlines: true,
  });
  if (!sanitizedNote) {
    throw withStatus("Incident note is required", 400);
  }

  const noteResult = await client.query(
    `
    INSERT INTO incident_notes (incident_id, admin_user_id, note, metadata)
    VALUES ($1,$2,$3,$4::jsonb)
    RETURNING *
    `,
    [
      incidentId,
      adminId,
      sanitizedNote,
      JSON.stringify(normalizeMetadata(metadata)),
    ]
  );
  const insertedNote = noteResult.rows[0];

  await client.query(
    `
    INSERT INTO incident_events (
      incident_id,
      actor_user_id,
      event_type,
      note_id,
      details,
      metadata
    )
    VALUES ($1,$2,'INCIDENT_NOTE_ADDED',$3,$4,$5::jsonb)
    `,
    [
      incidentId,
      adminId,
      insertedNote.id,
      sanitizedNote,
      JSON.stringify({ note_id: insertedNote.id }),
    ]
  );

  return getIncidentDetail({ client, incidentId });
}

async function addIncidentPostmortem({
  client = pool,
  incidentId,
  adminId,
  rootCause,
  impactSummary,
  detectionMethod,
  resolutionSummary,
  followUpActions,
  metadata = {},
} = {}) {
  await assertAdmin({ client, userId: adminId });
  const incident = await getIncidentState({ client, incidentId, forUpdate: true });
  if (!incident) return null;
  if (!["RESOLVED", "CLOSED"].includes(incident.status)) {
    throw withStatus("Postmortems are available after an incident is resolved", 409);
  }

  const fields = {
    root_cause: normalizeText(rootCause, {
      maxLength: 3000,
      preserveNewlines: true,
    }),
    impact_summary: normalizeText(impactSummary, {
      maxLength: 3000,
      preserveNewlines: true,
    }),
    detection_method: normalizeText(detectionMethod, {
      maxLength: 1600,
      preserveNewlines: true,
    }),
    resolution_summary: normalizeText(resolutionSummary, {
      maxLength: 3000,
      preserveNewlines: true,
    }),
    follow_up_actions: normalizeText(followUpActions, {
      maxLength: 3000,
      preserveNewlines: true,
    }),
  };

  for (const [field, value] of Object.entries(fields)) {
    if (!value) {
      throw withStatus(`${field.replaceAll("_", " ")} is required`, 400);
    }
  }

  let postmortem;
  try {
    const postmortemResult = await client.query(
      `
      INSERT INTO incident_postmortems (
        incident_id,
        admin_user_id,
        root_cause,
        impact_summary,
        detection_method,
        resolution_summary,
        follow_up_actions,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      RETURNING *
      `,
      [
        incidentId,
        adminId,
        fields.root_cause,
        fields.impact_summary,
        fields.detection_method,
        fields.resolution_summary,
        fields.follow_up_actions,
        JSON.stringify(normalizeMetadata(metadata)),
      ]
    );
    postmortem = postmortemResult.rows[0];
  } catch (err) {
    if (err.code === "23505") {
      throw withStatus("Incident already has a postmortem", 409);
    }
    throw err;
  }

  await client.query(
    `
    INSERT INTO incident_events (
      incident_id,
      actor_user_id,
      event_type,
      postmortem_id,
      details,
      metadata
    )
    VALUES ($1,$2,'INCIDENT_POSTMORTEM_ADDED',$3,$4,$5::jsonb)
    `,
    [
      incidentId,
      adminId,
      postmortem.id,
      "Incident postmortem submitted",
      JSON.stringify({ postmortem_id: postmortem.id }),
    ]
  );

  return getIncidentDetail({ client, incidentId });
}

module.exports = {
  ANALYSIS,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_SOURCE_TYPES,
  INCIDENT_STATUSES,
  addIncidentNote,
  addIncidentPostmortem,
  assignIncident,
  createIncident,
  getIncidentDetail,
  listIncidents,
  transitionIncidentStatus,
};
