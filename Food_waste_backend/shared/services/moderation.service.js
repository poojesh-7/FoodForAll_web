const pool = require("../config/db");
const crypto = require("crypto");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");
const { providerDisplaySelect } = require("./providerDisplay.service");
const { uploadBuffer } = require("./cloudinary.service");
const {
  recordProviderReportValidated,
} = require("./trustEnforcement.service");
const store = require("./rateLimitStore.service");
const logger = require("../utils/logger");
const {
  sanitizeOptionalText,
  sanitizePlainText,
} = require("../utils/sanitize");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");
const { assertAdmin } = require("./authorization.service");

const REPORT_REASONS = new Set([
  "fake_listing",
  "unsafe_food",
  "expired_food",
  "provider_unavailable",
  "repeated_cancellations",
  "abusive_behavior",
  "incorrect_listing",
]);

const DUPLICATE_REPORT_MESSAGE =
  "You already reported this provider for this reservation.";
const REPORT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_REPORT_ATTACHMENTS = 3;
const MAX_REPORT_ATTACHMENT_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const REPORT_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MODERATION_CASE_STATUSES = new Set([
  "OPEN",
  "UNDER_REVIEW",
  "AWAITING_RESPONSE",
  "VALIDATED",
  "DISMISSED",
  "ESCALATED",
]);
const TERMINAL_MODERATION_CASE_STATUSES = new Set(["VALIDATED", "DISMISSED"]);

function normalizeReason(reason) {
  return sanitizePlainText(reason, { maxLength: 80 }).toLowerCase();
}

function normalizeCaseStatus(status) {
  const normalized = sanitizePlainText(status, { maxLength: 80 }).toUpperCase();
  if (!MODERATION_CASE_STATUSES.has(normalized)) {
    throw withStatus("Invalid moderation case status", 400);
  }
  return normalized;
}

function caseStatusForReportStatus(status) {
  if (status === "validated") return "VALIDATED";
  if (status === "dismissed") return "DISMISSED";
  return "OPEN";
}

function sanitizeCaseNote(note) {
  return sanitizeOptionalText(note, {
    maxLength: 1000,
    preserveNewlines: true,
  });
}

function reportCooldownKey(reportedBy) {
  return `report:cooldown:${reportedBy}`;
}

function withStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createAttachmentPublicId(reportId, index) {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(12).toString("hex");
  const normalizedReportId = String(reportId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `report_${normalizedReportId}_${index + 1}_${id}`;
}

function validateReportAttachmentFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw withStatus("Invalid attachment upload", 400);
  }

  if (!REPORT_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
    throw withStatus("Only JPG, JPEG, PNG, or WEBP images allowed", 400);
  }

  const fileSize = Number(file.size || file.buffer.length || 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw withStatus("Uploaded file is empty", 400);
  }

  if (fileSize > MAX_REPORT_ATTACHMENT_BYTES) {
    throw withStatus("Uploaded file is too large", 400);
  }

  return fileSize;
}

async function recordModerationCaseEvent({
  client = pool,
  caseId,
  actorUserId = null,
  eventType,
  fromStatus = null,
  toStatus = null,
  note = null,
  metadata = {},
}) {
  const sanitizedNote = sanitizeCaseNote(note);
  const result = await client.query(
    `
    INSERT INTO moderation_case_events
      (case_id, actor_user_id, event_type, from_status, to_status, note, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    RETURNING id, case_id, actor_user_id, event_type, from_status, to_status,
              note, metadata, created_at
    `,
    [
      caseId,
      actorUserId,
      eventType,
      fromStatus,
      toStatus,
      sanitizedNote,
      JSON.stringify(metadata || {}),
    ]
  );

  return result.rows[0];
}

async function createModerationCaseForProviderReport({
  client = pool,
  report,
  actorUserId = null,
  initialStatus = "OPEN",
}) {
  const status = normalizeCaseStatus(initialStatus);
  const result = await client.query(
    `
    INSERT INTO moderation_cases
      (case_type, subject_type, subject_id, status, opened_by_user_id,
       source_report_id, reason, summary, created_at, updated_at, closed_at)
    VALUES (
      'provider_report',
      'provider',
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      COALESCE($7::timestamp, NOW()),
      COALESCE($8::timestamp, COALESCE($7::timestamp, NOW())),
      CASE WHEN $2 IN ('VALIDATED', 'DISMISSED')
        THEN COALESCE($8::timestamp, COALESCE($7::timestamp, NOW()))
        ELSE NULL
      END
    )
    ON CONFLICT (source_report_id) WHERE source_report_id IS NOT NULL
    DO UPDATE SET
      subject_id=EXCLUDED.subject_id,
      reason=EXCLUDED.reason,
      summary=EXCLUDED.summary,
      updated_at=NOW()
    RETURNING *
    `,
    [
      report.provider_id,
      status,
      actorUserId || report.reported_by || null,
      report.id,
      report.reason || null,
      report.description || null,
      report.created_at || null,
      report.resolved_at || report.created_at || null,
    ]
  );
  const moderationCase = result.rows[0];

  await client.query(
    `
    UPDATE provider_reports
    SET moderation_case_id=$2
    WHERE id=$1
    AND moderation_case_id IS DISTINCT FROM $2
    `,
    [report.id, moderationCase.id]
  );

  const existingOpenEvent = await client.query(
    `
    SELECT id
    FROM moderation_case_events
    WHERE case_id=$1
    AND event_type='CASE_OPENED'
    LIMIT 1
    `,
    [moderationCase.id]
  );

  if (!existingOpenEvent.rows.length) {
    await recordModerationCaseEvent({
      client,
      caseId: moderationCase.id,
      actorUserId: actorUserId || report.reported_by || null,
      eventType: "CASE_OPENED",
      toStatus: "OPEN",
      metadata: {
        source: "provider_report",
        source_report_id: report.id,
        provider_id: report.provider_id,
        reservation_id: report.reservation_id || null,
        reason: report.reason || null,
      },
    });
  }

  return moderationCase;
}

async function ensureProviderReportModerationCase({
  client = pool,
  report,
  actorUserId = null,
}) {
  if (report.moderation_case_id) {
    const existing = await client.query(
      `
      SELECT *
      FROM moderation_cases
      WHERE id=$1
      LIMIT 1
      `,
      [report.moderation_case_id]
    );

    if (existing.rows[0]) return existing.rows[0];
  }

  const bySource = await client.query(
    `
    SELECT *
    FROM moderation_cases
    WHERE source_report_id=$1
    LIMIT 1
    `,
    [report.id]
  );

  if (bySource.rows[0]) {
    await client.query(
      `
      UPDATE provider_reports
      SET moderation_case_id=$2
      WHERE id=$1
      AND moderation_case_id IS DISTINCT FROM $2
      `,
      [report.id, bySource.rows[0].id]
    );
    return bySource.rows[0];
  }

  return createModerationCaseForProviderReport({
    client,
    report,
    actorUserId,
    initialStatus: "OPEN",
  });
}

async function transitionModerationCaseStatus({
  client = pool,
  caseId,
  adminId,
  status,
  note = null,
  metadata = {},
}) {
  await ensureRestrictionSchema(client);
  await assertAdmin({ client, userId: adminId });

  const nextStatus = normalizeCaseStatus(status);
  const currentResult = await client.query(
    `
    SELECT *
    FROM moderation_cases
    WHERE id=$1
    FOR UPDATE
    `,
    [caseId]
  );
  const current = currentResult.rows[0];
  if (!current) return null;

  if (
    TERMINAL_MODERATION_CASE_STATUSES.has(current.status) &&
    current.status !== nextStatus
  ) {
    throw withStatus("Terminal moderation cases cannot be changed", 409);
  }

  if (current.status === nextStatus) {
    return current;
  }

  const result = await client.query(
    `
    UPDATE moderation_cases
    SET status=$2,
        assigned_admin_id=COALESCE(assigned_admin_id, $3),
        updated_at=NOW(),
        closed_at=CASE
          WHEN $2 IN ('VALIDATED', 'DISMISSED') THEN NOW()
          ELSE NULL
        END
    WHERE id=$1
    RETURNING *
    `,
    [caseId, nextStatus, adminId]
  );
  const updated = result.rows[0];

  await recordModerationCaseEvent({
    client,
    caseId,
    actorUserId: adminId,
    eventType: "CASE_STATUS_CHANGED",
    fromStatus: current.status,
    toStatus: nextStatus,
    note,
    metadata: {
      ...(metadata || {}),
      previous_status: current.status,
      next_status: nextStatus,
    },
  });

  return updated;
}

async function createProviderReport({
  client = pool,
  providerId,
  reportedBy,
  reservationId = null,
  reason,
  description = null,
  applyCooldown = true,
}) {
  await ensureRestrictionSchema(client);
  const normalizedReason = normalizeReason(reason);
  const sanitizedDescription = sanitizeOptionalText(description, {
    maxLength: 1000,
    preserveNewlines: true,
  });

  if (!REPORT_REASONS.has(normalizedReason)) {
    const error = new Error("Invalid report reason");
    error.statusCode = 400;
    throw error;
  }

  const cooldownKey = reportCooldownKey(reportedBy);
  const cooldown = await store.get(cooldownKey);
  if (cooldown.value) {
    const error = new Error("Please wait before submitting another report.");
    error.statusCode = 429;
    error.retryAfter = Math.max(1, Math.ceil(cooldown.ttlMs / 1000));
    throw error;
  }

  const existing = await client.query(
    `
    SELECT id
    FROM provider_reports
    WHERE provider_id=$1
    AND reported_by=$2
    AND reservation_id=$3
    AND (
      status='pending'
      OR created_at > NOW() - INTERVAL '30 days'
    )
    LIMIT 1
    `,
    [providerId, reportedBy, reservationId]
  );

  if (existing.rows.length) {
    const error = new Error(DUPLICATE_REPORT_MESSAGE);
    error.statusCode = 409;
    throw error;
  }

  const recentReporterActivity = await client.query(
    `
    SELECT COUNT(*)::int AS report_count
    FROM provider_reports
    WHERE reported_by=$1
    AND created_at > NOW() - INTERVAL '24 hours'
    `,
    [reportedBy]
  );

  if (Number(recentReporterActivity.rows[0]?.report_count || 0) >= 8) {
    const event = {
      reportedBy,
      providerId,
      reservationId,
    };
    logger.security("Suspicious provider report volume", event);
    void recordOperationalEvent({
      category: "security",
      severity: "warning",
      eventName: "suspicious_provider_report_volume",
      metadata: event,
    });
    void recordAlert({
      alertKey: "security:provider_report_volume",
      category: "security",
      severity: "warning",
      message: "Suspicious provider report volume",
      metadata: event,
    });
  }

  try {
    const reportResult = await client.query(
      `
      INSERT INTO provider_reports
        (provider_id, reported_by, reservation_id, reason, description, status)
      VALUES ($1,$2,$3,$4,$5,'pending')
      RETURNING *
      `,
      [
        providerId,
        reportedBy,
        reservationId,
        normalizedReason,
        sanitizedDescription,
      ]
    );
    let report = reportResult.rows[0];
    const moderationCase = await createModerationCaseForProviderReport({
      client,
      report,
      actorUserId: reportedBy,
      initialStatus: "OPEN",
    });
    report = {
      ...report,
      moderation_case_id: moderationCase.id,
      moderation_case_status: moderationCase.status,
    };

    if (applyCooldown) {
      await applyProviderReportCooldown({ reportedBy });
    }
    logger.security("Provider report submitted", {
      reportedBy,
      providerId,
      reservationId,
      reason: normalizedReason,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "provider_report_submitted",
      metadata: {
        reportedBy,
        providerId,
        reservationId,
        reason: normalizedReason,
      },
    });
    return report;
  } catch (err) {
    if (
      err.code === "23505" &&
      err.constraint === "idx_provider_reports_unique_pending"
    ) {
      const error = new Error(DUPLICATE_REPORT_MESSAGE);
      error.statusCode = 409;
      throw error;
    }

    throw err;
  }
}

async function applyProviderReportCooldown({ reportedBy }) {
  await store.set(reportCooldownKey(reportedBy), "1", REPORT_COOLDOWN_MS);
}

async function addProviderReportAttachments({
  client = pool,
  reportId,
  uploaderUserId,
  files = [],
}) {
  await ensureRestrictionSchema(client);

  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  if (files.length > MAX_REPORT_ATTACHMENTS) {
    throw withStatus("A report can include up to 3 images", 400);
  }

  const storagePrefix = process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local";
  const attachments = [];

  for (const [index, file] of files.entries()) {
    const fileSize = validateReportAttachmentFile(file);
    const uploadedImage = await uploadBuffer(file.buffer, {
      folder: `food-rescue/${storagePrefix}/provider-report-evidence`,
      public_id: createAttachmentPublicId(reportId, index),
      mimetype: file.mimetype,
    });

    const result = await client.query(
      `
      INSERT INTO provider_report_attachments
        (report_id, uploader_user_id, file_url, mime_type, file_size_bytes)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, report_id, uploader_user_id, file_url, mime_type, file_size_bytes, created_at
      `,
      [
        reportId,
        uploaderUserId,
        uploadedImage.secure_url,
        file.mimetype,
        fileSize,
      ]
    );

    attachments.push(result.rows[0]);
  }

  return attachments;
}

async function validateProviderReport({ client = pool, reportId, adminId, note = null }) {
  await ensureRestrictionSchema(client);
  await assertAdmin({ client, userId: adminId });

  const reportResult = await client.query(
    `
    UPDATE provider_reports
    SET status='validated',
        resolved_at=NOW(),
        reviewed_by_admin=$2
    WHERE id=$1
    AND status='pending'
    RETURNING *
    `,
    [reportId, adminId]
  );

  const report = reportResult.rows[0];
  if (!report) return null;
  const moderationCase = await ensureProviderReportModerationCase({
    client,
    report,
    actorUserId: adminId,
  });

  await recordProviderReportValidated({
    client,
    report,
  });

  const updatedCase = await transitionModerationCaseStatus({
    client,
    caseId: moderationCase.id,
    adminId,
    status: "VALIDATED",
    note,
    metadata: {
      source: "provider_report_review",
      report_id: report.id,
      review_action: "validate",
    },
  });

  return {
    ...report,
    moderation_case_id: updatedCase?.id || moderationCase.id,
    moderation_case_status: updatedCase?.status || moderationCase.status,
  };
}

async function dismissProviderReport({ client = pool, reportId, adminId, note = null }) {
  await ensureRestrictionSchema(client);
  await assertAdmin({ client, userId: adminId });

  const result = await client.query(
    `
    UPDATE provider_reports
    SET status='dismissed',
        resolved_at=NOW(),
        reviewed_by_admin=$2
    WHERE id=$1
    AND status='pending'
    RETURNING *
    `,
    [reportId, adminId]
  );

  const report = result.rows[0];
  if (!report) return null;

  const moderationCase = await ensureProviderReportModerationCase({
    client,
    report,
    actorUserId: adminId,
  });
  const updatedCase = await transitionModerationCaseStatus({
    client,
    caseId: moderationCase.id,
    adminId,
    status: "DISMISSED",
    note,
    metadata: {
      source: "provider_report_review",
      report_id: report.id,
      review_action: "dismiss",
    },
  });

  return {
    ...report,
    moderation_case_id: updatedCase?.id || moderationCase.id,
    moderation_case_status: updatedCase?.status || moderationCase.status,
  };
}

async function listProviderReports({ client = pool, status = "pending" } = {}) {
  await ensureRestrictionSchema(client);
  const result = await client.query(
    `
    SELECT pr.*,
           moderation_case.id AS moderation_case_id,
           moderation_case.status AS moderation_case_status,
           ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
           COALESCE(reporter_ngo.organization_name, reporter.name) AS reporter_name,
           reporter.role AS reporter_role,
           r.pickup_type AS reservation_pickup_type,
           r.status AS reservation_status,
           r.task_status AS reservation_task_status,
           f.title AS listing_title,
           COALESCE(report_attachments.attachments, '[]'::json) AS attachments
    FROM provider_reports pr
    JOIN users provider ON provider.id = pr.provider_id
    JOIN users reporter ON reporter.id = pr.reported_by
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id=provider.id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    LEFT JOIN ngos reporter_ngo ON reporter_ngo.user_id = reporter.id
    LEFT JOIN reservations r ON r.id = pr.reservation_id
    LEFT JOIN food_listings f ON f.id = r.listing_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', pra.id,
          'report_id', pra.report_id,
          'uploader_user_id', pra.uploader_user_id,
          'file_url', pra.file_url,
          'mime_type', pra.mime_type,
          'file_size_bytes', pra.file_size_bytes,
          'created_at', pra.created_at
        )
        ORDER BY pra.created_at ASC, pra.id ASC
      ) AS attachments
      FROM provider_report_attachments pra
      WHERE pra.report_id = pr.id
    ) report_attachments ON true
    LEFT JOIN LATERAL (
      SELECT mc.id, mc.status
      FROM moderation_cases mc
      WHERE mc.id = pr.moderation_case_id
      OR mc.source_report_id = pr.id
      ORDER BY CASE WHEN mc.id = pr.moderation_case_id THEN 0 ELSE 1 END,
               mc.created_at DESC
      LIMIT 1
    ) moderation_case ON true
    WHERE ($1::text IS NULL OR pr.status=$1)
    ORDER BY pr.created_at DESC
    `,
    [status || null]
  );
  return result.rows;
}

function buildModerationCaseDetail(row, events) {
  return {
    id: row.case_id,
    case_type: row.case_type,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    status: row.case_status,
    opened_by_user_id: row.opened_by_user_id,
    assigned_admin_id: row.assigned_admin_id,
    source_report_id: row.source_report_id,
    reason: row.case_reason,
    summary: row.case_summary,
    created_at: row.case_created_at,
    updated_at: row.case_updated_at,
    closed_at: row.closed_at,
    provider_name: row.provider_name,
    assigned_admin_name: row.assigned_admin_name,
    events,
    report: row.report_id
      ? {
          id: row.report_id,
          provider_id: row.report_provider_id,
          reported_by: row.reported_by,
          reservation_id: row.reservation_id,
          reason: row.report_reason,
          description: row.report_description,
          status: row.report_status,
          created_at: row.report_created_at,
          resolved_at: row.resolved_at,
          reviewed_by_admin: row.reviewed_by_admin,
          provider_name: row.provider_name,
          reporter_name: row.reporter_name,
          reporter_role: row.reporter_role,
          reservation_pickup_type: row.reservation_pickup_type,
          reservation_status: row.reservation_status,
          reservation_task_status: row.reservation_task_status,
          listing_title: row.listing_title,
          attachments: row.attachments || [],
        }
      : null,
  };
}

async function getModerationCaseDetail({ client = pool, caseId }) {
  await ensureRestrictionSchema(client);
  const result = await client.query(
    `
    SELECT mc.id AS case_id,
           mc.case_type,
           mc.subject_type,
           mc.subject_id,
           mc.status AS case_status,
           mc.opened_by_user_id,
           mc.assigned_admin_id,
           mc.source_report_id,
           mc.reason AS case_reason,
           mc.summary AS case_summary,
           mc.created_at AS case_created_at,
           mc.updated_at AS case_updated_at,
           mc.closed_at,
           ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
           assigned_admin.name AS assigned_admin_name,
           pr.id AS report_id,
           pr.provider_id AS report_provider_id,
           pr.reported_by,
           pr.reservation_id,
           pr.reason AS report_reason,
           pr.description AS report_description,
           pr.status AS report_status,
           pr.created_at AS report_created_at,
           pr.resolved_at,
           pr.reviewed_by_admin,
           COALESCE(reporter_ngo.organization_name, reporter.name) AS reporter_name,
           reporter.role AS reporter_role,
           r.pickup_type AS reservation_pickup_type,
           r.status AS reservation_status,
           r.task_status AS reservation_task_status,
           f.title AS listing_title,
           COALESCE(report_attachments.attachments, '[]'::json) AS attachments
    FROM moderation_cases mc
    JOIN users provider ON provider.id = mc.subject_id
    LEFT JOIN users assigned_admin ON assigned_admin.id = mc.assigned_admin_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id=provider.id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    LEFT JOIN provider_reports pr ON pr.id = mc.source_report_id
      OR pr.moderation_case_id = mc.id
    LEFT JOIN users reporter ON reporter.id = pr.reported_by
    LEFT JOIN ngos reporter_ngo ON reporter_ngo.user_id = reporter.id
    LEFT JOIN reservations r ON r.id = pr.reservation_id
    LEFT JOIN food_listings f ON f.id = r.listing_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', pra.id,
          'report_id', pra.report_id,
          'uploader_user_id', pra.uploader_user_id,
          'file_url', pra.file_url,
          'mime_type', pra.mime_type,
          'file_size_bytes', pra.file_size_bytes,
          'created_at', pra.created_at
        )
        ORDER BY pra.created_at ASC, pra.id ASC
      ) AS attachments
      FROM provider_report_attachments pra
      WHERE pra.report_id = pr.id
    ) report_attachments ON true
    WHERE mc.id=$1
    ORDER BY pr.created_at DESC NULLS LAST
    LIMIT 1
    `,
    [caseId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const eventsResult = await client.query(
    `
    SELECT mce.id,
           mce.case_id,
           mce.actor_user_id,
           actor.name AS actor_name,
           actor.role AS actor_role,
           mce.event_type,
           mce.from_status,
           mce.to_status,
           mce.note,
           mce.metadata,
           mce.created_at
    FROM moderation_case_events mce
    LEFT JOIN users actor ON actor.id = mce.actor_user_id
    WHERE mce.case_id=$1
    ORDER BY mce.created_at ASC, mce.id ASC
    `,
    [caseId]
  );

  return buildModerationCaseDetail(row, eventsResult.rows);
}

module.exports = {
  DUPLICATE_REPORT_MESSAGE,
  MAX_REPORT_ATTACHMENTS,
  MODERATION_CASE_STATUSES,
  REPORT_REASONS,
  addProviderReportAttachments,
  applyProviderReportCooldown,
  createProviderReport,
  dismissProviderReport,
  getModerationCaseDetail,
  listProviderReports,
  transitionModerationCaseStatus,
  validateProviderReport,
};
