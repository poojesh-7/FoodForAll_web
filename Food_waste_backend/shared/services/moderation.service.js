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
const MAX_PROVIDER_RESPONSE_ATTACHMENTS = 3;
const MAX_APPEAL_ATTACHMENTS = 3;
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
const MODERATION_APPEAL_STATUSES = new Set([
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
]);
const TERMINAL_MODERATION_APPEAL_STATUSES = new Set([
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
]);

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

function normalizeAppealStatus(status) {
  const normalized = sanitizePlainText(status, { maxLength: 80 }).toUpperCase();
  if (!MODERATION_APPEAL_STATUSES.has(normalized)) {
    throw withStatus("Invalid appeal status", 400);
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

function createResponseAttachmentPublicId(responseId, index) {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(12).toString("hex");
  const normalizedResponseId = String(responseId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `provider_response_${normalizedResponseId}_${index + 1}_${id}`;
}

function createAppealAttachmentPublicId(appealId, index) {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(12).toString("hex");
  const normalizedAppealId = String(appealId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `moderation_appeal_${normalizedAppealId}_${index + 1}_${id}`;
}

function isTerminalCaseStatus(status) {
  return TERMINAL_MODERATION_CASE_STATUSES.has(String(status || "").toUpperCase());
}

function isTerminalAppealStatus(status) {
  return TERMINAL_MODERATION_APPEAL_STATUSES.has(String(status || "").toUpperCase());
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

async function recordModerationAppealEvent({
  client = pool,
  appealId,
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
    INSERT INTO moderation_appeal_events
      (appeal_id, case_id, actor_user_id, event_type, from_status, to_status,
       note, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    RETURNING id, appeal_id, case_id, actor_user_id, event_type, from_status,
              to_status, note, metadata, created_at
    `,
    [
      appealId,
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

async function addProviderCaseResponseAttachments({
  client = pool,
  responseId,
  files = [],
  startingIndex = 0,
}) {
  await ensureRestrictionSchema(client);

  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  if (files.length > MAX_PROVIDER_RESPONSE_ATTACHMENTS) {
    throw withStatus("A provider response can include up to 3 images", 400);
  }

  const storagePrefix = process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local";
  const attachments = [];

  for (const [index, file] of files.entries()) {
    const fileSize = validateReportAttachmentFile(file);
    const uploadedImage = await uploadBuffer(file.buffer, {
      folder: `food-rescue/${storagePrefix}/provider-response-evidence`,
      public_id: createResponseAttachmentPublicId(responseId, startingIndex + index),
      mimetype: file.mimetype,
    });

    const result = await client.query(
      `
      INSERT INTO provider_case_response_attachments
        (response_id, file_url, mime_type, file_size_bytes)
      VALUES ($1,$2,$3,$4)
      RETURNING id, response_id, file_url, mime_type, file_size_bytes, created_at
      `,
      [
        responseId,
        uploadedImage.secure_url,
        file.mimetype,
        fileSize,
      ]
    );

    attachments.push(result.rows[0]);
  }

  return attachments;
}

async function addModerationAppealAttachments({
  client = pool,
  appealId,
  uploaderUserId,
  files = [],
  startingIndex = 0,
}) {
  await ensureRestrictionSchema(client);

  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  if (files.length > MAX_APPEAL_ATTACHMENTS) {
    throw withStatus("An appeal can include up to 3 images", 400);
  }

  const storagePrefix = process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local";
  const attachments = [];

  for (const [index, file] of files.entries()) {
    const fileSize = validateReportAttachmentFile(file);
    const uploadedImage = await uploadBuffer(file.buffer, {
      folder: `food-rescue/${storagePrefix}/moderation-appeal-evidence`,
      public_id: createAppealAttachmentPublicId(appealId, startingIndex + index),
      mimetype: file.mimetype,
    });

    const result = await client.query(
      `
      INSERT INTO moderation_appeal_attachments
        (appeal_id, uploader_user_id, file_url, mime_type, file_size_bytes)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, appeal_id, uploader_user_id, file_url, mime_type,
                file_size_bytes, created_at
      `,
      [
        appealId,
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

async function loadModerationCaseForProvider({
  client = pool,
  caseId,
  providerId,
  forUpdate = false,
}) {
  await ensureRestrictionSchema(client);
  const result = await client.query(
    `
    SELECT *
    FROM moderation_cases
    WHERE id=$1
    ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [caseId]
  );
  const moderationCase = result.rows[0];
  if (!moderationCase) return null;

  if (
    moderationCase.subject_type !== "provider" ||
    String(moderationCase.subject_id) !== String(providerId)
  ) {
    throw withStatus("Provider is not authorized for this moderation case", 403);
  }

  return moderationCase;
}

async function listProviderCaseResponses({ client = pool, caseId }) {
  const result = await client.query(
    `
    SELECT pcr.id,
           pcr.case_id,
           pcr.provider_id,
           provider.name AS provider_name,
           pcr.response_text,
           pcr.created_at,
           pcr.updated_at,
           COALESCE(response_attachments.attachments, '[]'::json) AS attachments
    FROM provider_case_responses pcr
    JOIN users provider ON provider.id = pcr.provider_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', pcra.id,
          'response_id', pcra.response_id,
          'file_url', pcra.file_url,
          'mime_type', pcra.mime_type,
          'file_size_bytes', pcra.file_size_bytes,
          'created_at', pcra.created_at
        )
        ORDER BY pcra.created_at ASC, pcra.id ASC
      ) AS attachments
      FROM provider_case_response_attachments pcra
      WHERE pcra.response_id = pcr.id
    ) response_attachments ON true
    WHERE pcr.case_id=$1
    ORDER BY pcr.created_at ASC, pcr.id ASC
    `,
    [caseId]
  );

  return result.rows;
}

async function listModerationAppealEvents({ client = pool, appealId }) {
  const result = await client.query(
    `
    SELECT mae.id,
           mae.appeal_id,
           mae.case_id,
           mae.actor_user_id,
           actor.name AS actor_name,
           actor.role AS actor_role,
           mae.event_type,
           mae.from_status,
           mae.to_status,
           mae.note,
           mae.metadata,
           mae.created_at
    FROM moderation_appeal_events mae
    LEFT JOIN users actor ON actor.id = mae.actor_user_id
    WHERE mae.appeal_id=$1
    ORDER BY mae.created_at ASC, mae.id ASC
    `,
    [appealId]
  );

  return result.rows;
}

async function appendAppealEvents({ client = pool, appeals = [] }) {
  const enriched = [];
  for (const appeal of appeals) {
    enriched.push({
      ...appeal,
      events: await listModerationAppealEvents({ client, appealId: appeal.id }),
    });
  }
  return enriched;
}

async function listModerationAppealsForCase({ client = pool, caseId }) {
  const result = await client.query(
    `
    SELECT ma.id,
           ma.case_id,
           ma.provider_id,
           provider.name AS provider_name,
           reviewer.name AS reviewed_by_admin_name,
           ma.status,
           ma.appeal_text,
           ma.decision_note,
           ma.reviewed_by_admin,
           ma.submitted_at,
           ma.reviewed_at,
           ma.withdrawn_at,
           ma.withdrawn_by_user_id,
           ma.created_at,
           ma.updated_at,
           COALESCE(appeal_attachments.attachments, '[]'::json) AS attachments
    FROM moderation_appeals ma
    JOIN users provider ON provider.id = ma.provider_id
    LEFT JOIN users reviewer ON reviewer.id = ma.reviewed_by_admin
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', maa.id,
          'appeal_id', maa.appeal_id,
          'uploader_user_id', maa.uploader_user_id,
          'file_url', maa.file_url,
          'mime_type', maa.mime_type,
          'file_size_bytes', maa.file_size_bytes,
          'created_at', maa.created_at
        )
        ORDER BY maa.created_at ASC, maa.id ASC
      ) AS attachments
      FROM moderation_appeal_attachments maa
      WHERE maa.appeal_id = ma.id
    ) appeal_attachments ON true
    WHERE ma.case_id=$1
    ORDER BY ma.created_at ASC, ma.id ASC
    `,
    [caseId]
  );

  return appendAppealEvents({ client, appeals: result.rows });
}

async function getModerationAppealDetail({ client = pool, appealId }) {
  const result = await client.query(
    `
    SELECT ma.id,
           ma.case_id,
           ma.provider_id,
           provider.name AS provider_name,
           reviewer.name AS reviewed_by_admin_name,
           ma.status,
           ma.appeal_text,
           ma.decision_note,
           ma.reviewed_by_admin,
           ma.submitted_at,
           ma.reviewed_at,
           ma.withdrawn_at,
           ma.withdrawn_by_user_id,
           ma.created_at,
           ma.updated_at,
           COALESCE(appeal_attachments.attachments, '[]'::json) AS attachments
    FROM moderation_appeals ma
    JOIN users provider ON provider.id = ma.provider_id
    LEFT JOIN users reviewer ON reviewer.id = ma.reviewed_by_admin
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', maa.id,
          'appeal_id', maa.appeal_id,
          'uploader_user_id', maa.uploader_user_id,
          'file_url', maa.file_url,
          'mime_type', maa.mime_type,
          'file_size_bytes', maa.file_size_bytes,
          'created_at', maa.created_at
        )
        ORDER BY maa.created_at ASC, maa.id ASC
      ) AS attachments
      FROM moderation_appeal_attachments maa
      WHERE maa.appeal_id = ma.id
    ) appeal_attachments ON true
    WHERE ma.id=$1
    LIMIT 1
    `,
    [appealId]
  );

  const appeal = result.rows[0];
  if (!appeal) return null;
  return (await appendAppealEvents({ client, appeals: [appeal] }))[0];
}

function normalizeAppealListStatus(status) {
  const normalized = sanitizePlainText(status || "open", { maxLength: 80 }).toUpperCase();
  if (normalized === "ALL") return "all";
  if (normalized === "OPEN") return "open";
  if (!MODERATION_APPEAL_STATUSES.has(normalized)) {
    throw withStatus("Invalid appeal status filter", 400);
  }
  return normalized;
}

async function listModerationAppeals({ client = pool, status = "open" } = {}) {
  await ensureRestrictionSchema(client);
  const normalizedStatus = normalizeAppealListStatus(status);
  const result = await client.query(
    `
    SELECT ma.id,
           ma.case_id,
           ma.provider_id,
           ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
           reviewer.name AS reviewed_by_admin_name,
           ma.status,
           ma.appeal_text,
           ma.decision_note,
           ma.reviewed_by_admin,
           ma.submitted_at,
           ma.reviewed_at,
           ma.withdrawn_at,
           ma.withdrawn_by_user_id,
           ma.created_at,
           ma.updated_at,
           mc.status AS case_status,
           mc.reason AS case_reason,
           mc.summary AS case_summary,
           pr.id AS report_id,
           pr.reason AS report_reason,
           pr.status AS report_status,
           f.title AS listing_title,
           COALESCE(appeal_attachments.attachment_count, 0)::int AS attachment_count,
           COALESCE(appeal_attachments.attachments, '[]'::json) AS attachments
    FROM moderation_appeals ma
    JOIN moderation_cases mc ON mc.id = ma.case_id
    JOIN users provider ON provider.id = ma.provider_id
    LEFT JOIN users reviewer ON reviewer.id = ma.reviewed_by_admin
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
    LEFT JOIN reservations r ON r.id = pr.reservation_id
    LEFT JOIN food_listings f ON f.id = r.listing_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS attachment_count,
             json_agg(
               json_build_object(
                 'id', maa.id,
                 'appeal_id', maa.appeal_id,
                 'uploader_user_id', maa.uploader_user_id,
                 'file_url', maa.file_url,
                 'mime_type', maa.mime_type,
                 'file_size_bytes', maa.file_size_bytes,
                 'created_at', maa.created_at
               )
               ORDER BY maa.created_at ASC, maa.id ASC
             ) AS attachments
      FROM moderation_appeal_attachments maa
      WHERE maa.appeal_id = ma.id
    ) appeal_attachments ON true
    WHERE (
      $1::text = 'all'
      OR ($1::text = 'open' AND ma.status IN ('SUBMITTED', 'UNDER_REVIEW'))
      OR ma.status = $2
    )
    ORDER BY
      CASE
        WHEN ma.status='SUBMITTED' THEN 0
        WHEN ma.status='UNDER_REVIEW' THEN 1
        ELSE 2
      END,
      ma.updated_at DESC,
      ma.created_at DESC
    `,
    [
      normalizedStatus,
      MODERATION_APPEAL_STATUSES.has(normalizedStatus)
        ? normalizedStatus
        : null,
    ]
  );

  return result.rows;
}

async function listProviderModerationCases({ client = pool, providerId }) {
  await ensureRestrictionSchema(client);
  const result = await client.query(
    `
    SELECT mc.id,
           mc.case_type,
           mc.subject_type,
           mc.subject_id,
           mc.status,
           mc.reason,
           mc.summary,
           mc.source_report_id,
           mc.created_at,
           mc.updated_at,
           mc.closed_at,
           pr.id AS report_id,
           pr.reason AS report_reason,
           pr.status AS report_status,
           pr.created_at AS report_created_at,
           f.title AS listing_title,
           pcr.id AS provider_response_id,
           pcr.updated_at AS provider_response_updated_at,
           COALESCE(response_attachment_counts.attachment_count, 0)::int
             AS provider_response_attachment_count,
           appeal.id AS appeal_id,
           appeal.status AS appeal_status,
           appeal.updated_at AS appeal_updated_at,
           COALESCE(appeal_attachment_counts.attachment_count, 0)::int
             AS appeal_attachment_count
    FROM moderation_cases mc
    LEFT JOIN provider_reports pr ON pr.id = mc.source_report_id
      OR pr.moderation_case_id = mc.id
    LEFT JOIN reservations r ON r.id = pr.reservation_id
    LEFT JOIN food_listings f ON f.id = r.listing_id
    LEFT JOIN provider_case_responses pcr ON pcr.case_id = mc.id
      AND pcr.provider_id = mc.subject_id
    LEFT JOIN moderation_appeals appeal ON appeal.case_id = mc.id
      AND appeal.provider_id = mc.subject_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS attachment_count
      FROM provider_case_response_attachments pcra
      WHERE pcra.response_id = pcr.id
    ) response_attachment_counts ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS attachment_count
      FROM moderation_appeal_attachments maa
      WHERE maa.appeal_id = appeal.id
    ) appeal_attachment_counts ON true
    WHERE mc.subject_type='provider'
    AND mc.subject_id=$1
    ORDER BY
      CASE
        WHEN mc.status='AWAITING_RESPONSE' THEN 0
        WHEN mc.status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED') THEN 1
        ELSE 2
      END,
      mc.updated_at DESC,
      mc.created_at DESC
    `,
    [providerId]
  );

  return result.rows;
}

async function getProviderModerationCaseDetail({
  client = pool,
  caseId,
  providerId,
}) {
  const moderationCase = await loadModerationCaseForProvider({
    client,
    caseId,
    providerId,
  });
  if (!moderationCase) return null;

  return getModerationCaseDetail({ client, caseId });
}

async function getProviderCaseResponse({ client = pool, responseId }) {
  const result = await client.query(
    `
    SELECT pcr.id,
           pcr.case_id,
           pcr.provider_id,
           provider.name AS provider_name,
           pcr.response_text,
           pcr.created_at,
           pcr.updated_at,
           COALESCE(response_attachments.attachments, '[]'::json) AS attachments
    FROM provider_case_responses pcr
    JOIN users provider ON provider.id = pcr.provider_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', pcra.id,
          'response_id', pcra.response_id,
          'file_url', pcra.file_url,
          'mime_type', pcra.mime_type,
          'file_size_bytes', pcra.file_size_bytes,
          'created_at', pcra.created_at
        )
        ORDER BY pcra.created_at ASC, pcra.id ASC
      ) AS attachments
      FROM provider_case_response_attachments pcra
      WHERE pcra.response_id = pcr.id
    ) response_attachments ON true
    WHERE pcr.id=$1
    LIMIT 1
    `,
    [responseId]
  );

  return result.rows[0] || null;
}

async function submitProviderCaseResponse({
  client = pool,
  caseId,
  providerId,
  responseText,
  files = [],
}) {
  await ensureRestrictionSchema(client);
  const sanitizedResponse = sanitizeOptionalText(responseText, {
    maxLength: 3000,
    preserveNewlines: true,
  });

  if (!sanitizedResponse) {
    throw withStatus("Response text is required", 400);
  }

  const moderationCase = await loadModerationCaseForProvider({
    client,
    caseId,
    providerId,
    forUpdate: true,
  });
  if (!moderationCase) return null;

  if (isTerminalCaseStatus(moderationCase.status)) {
    throw withStatus("Terminal moderation cases are read-only", 409);
  }

  const responseResult = await client.query(
    `
    SELECT *
    FROM provider_case_responses
    WHERE case_id=$1
    AND provider_id=$2
    FOR UPDATE
    `,
    [caseId, providerId]
  );
  const existingResponse = responseResult.rows[0];
  let response;
  let responseAction = "created";

  if (existingResponse) {
    responseAction = "updated";
    const updated = await client.query(
      `
      UPDATE provider_case_responses
      SET response_text=$3,
          updated_at=NOW()
      WHERE case_id=$1
      AND provider_id=$2
      RETURNING *
      `,
      [caseId, providerId, sanitizedResponse]
    );
    response = updated.rows[0];
  } else {
    const inserted = await client.query(
      `
      INSERT INTO provider_case_responses
        (case_id, provider_id, response_text)
      VALUES ($1,$2,$3)
      RETURNING *
      `,
      [caseId, providerId, sanitizedResponse]
    );
    response = inserted.rows[0];
  }

  const existingAttachmentCount = await client.query(
    `
    SELECT COUNT(*)::int AS attachment_count
    FROM provider_case_response_attachments
    WHERE response_id=$1
    `,
    [response.id]
  );
  const attachmentCount = Number(existingAttachmentCount.rows[0]?.attachment_count || 0);

  if (attachmentCount + (files?.length || 0) > MAX_PROVIDER_RESPONSE_ATTACHMENTS) {
    throw withStatus("A provider response can include up to 3 images", 400);
  }

  const attachments = await addProviderCaseResponseAttachments({
    client,
    responseId: response.id,
    files,
    startingIndex: attachmentCount,
  });

  await recordModerationCaseEvent({
    client,
    caseId,
    actorUserId: providerId,
    eventType: "CASE_PROVIDER_RESPONSE_SUBMITTED",
    metadata: {
      source: "provider_case_response",
      response_id: response.id,
      response_action: responseAction,
      attachment_count: attachments.length,
      total_attachment_count: attachmentCount + attachments.length,
    },
  });

  return getProviderCaseResponse({ client, responseId: response.id });
}

async function submitProviderModerationAppeal({
  client = pool,
  caseId,
  providerId,
  appealText,
  files = [],
}) {
  await ensureRestrictionSchema(client);
  const sanitizedAppeal = sanitizeOptionalText(appealText, {
    maxLength: 3000,
    preserveNewlines: true,
  });

  if (!sanitizedAppeal) {
    throw withStatus("Appeal explanation is required", 400);
  }

  if ((files?.length || 0) > MAX_APPEAL_ATTACHMENTS) {
    throw withStatus("An appeal can include up to 3 images", 400);
  }

  const moderationCase = await loadModerationCaseForProvider({
    client,
    caseId,
    providerId,
    forUpdate: true,
  });
  if (!moderationCase) return null;

  if (!isTerminalCaseStatus(moderationCase.status)) {
    throw withStatus("Appeals are allowed only after a final moderation decision", 409);
  }

  const existing = await client.query(
    `
    SELECT *
    FROM moderation_appeals
    WHERE case_id=$1
    AND provider_id=$2
    FOR UPDATE
    `,
    [caseId, providerId]
  );

  if (existing.rows.length) {
    throw withStatus("An appeal already exists for this moderation case", 409);
  }

  const inserted = await client.query(
    `
    INSERT INTO moderation_appeals
      (case_id, provider_id, status, appeal_text)
    VALUES ($1,$2,'SUBMITTED',$3)
    RETURNING *
    `,
    [caseId, providerId, sanitizedAppeal]
  );
  const appeal = inserted.rows[0];

  const attachments = await addModerationAppealAttachments({
    client,
    appealId: appeal.id,
    uploaderUserId: providerId,
    files,
  });

  await recordModerationAppealEvent({
    client,
    appealId: appeal.id,
    caseId,
    actorUserId: providerId,
    eventType: "APPEAL_SUBMITTED",
    toStatus: "SUBMITTED",
    metadata: {
      source: "provider_moderation_appeal",
      attachment_count: attachments.length,
    },
  });

  await recordModerationCaseEvent({
    client,
    caseId,
    actorUserId: providerId,
    eventType: "CASE_APPEAL_SUBMITTED",
    metadata: {
      source: "provider_moderation_appeal",
      appeal_id: appeal.id,
      attachment_count: attachments.length,
    },
  });

  return getModerationAppealDetail({ client, appealId: appeal.id });
}

async function withdrawProviderModerationAppeal({
  client = pool,
  caseId,
  providerId,
  note = null,
}) {
  await ensureRestrictionSchema(client);
  const moderationCase = await loadModerationCaseForProvider({
    client,
    caseId,
    providerId,
    forUpdate: true,
  });
  if (!moderationCase) return null;

  const currentResult = await client.query(
    `
    SELECT *
    FROM moderation_appeals
    WHERE case_id=$1
    AND provider_id=$2
    FOR UPDATE
    `,
    [caseId, providerId]
  );
  const current = currentResult.rows[0];
  if (!current) return null;

  if (isTerminalAppealStatus(current.status)) {
    throw withStatus("Terminal appeals cannot be withdrawn", 409);
  }

  const result = await client.query(
    `
    UPDATE moderation_appeals
    SET status='WITHDRAWN',
        withdrawn_at=NOW(),
        withdrawn_by_user_id=$3,
        updated_at=NOW()
    WHERE id=$1
    AND case_id=$2
    RETURNING *
    `,
    [current.id, caseId, providerId]
  );
  const updated = result.rows[0];

  await recordModerationAppealEvent({
    client,
    appealId: updated.id,
    caseId,
    actorUserId: providerId,
    eventType: "APPEAL_WITHDRAWN",
    fromStatus: current.status,
    toStatus: "WITHDRAWN",
    note,
    metadata: {
      source: "provider_moderation_appeal_withdrawal",
    },
  });

  await recordModerationCaseEvent({
    client,
    caseId,
    actorUserId: providerId,
    eventType: "CASE_APPEAL_WITHDRAWN",
    metadata: {
      source: "provider_moderation_appeal_withdrawal",
      appeal_id: updated.id,
      previous_status: current.status,
    },
  });

  return getModerationAppealDetail({ client, appealId: updated.id });
}

async function transitionModerationAppealStatus({
  client = pool,
  appealId,
  adminId,
  status,
  note = null,
}) {
  await ensureRestrictionSchema(client);
  await assertAdmin({ client, userId: adminId });

  const nextStatus = normalizeAppealStatus(status);
  if (!["UNDER_REVIEW", "ACCEPTED", "REJECTED"].includes(nextStatus)) {
    throw withStatus("Invalid admin appeal action", 400);
  }

  const currentResult = await client.query(
    `
    SELECT ma.*, mc.status AS case_status
    FROM moderation_appeals ma
    JOIN moderation_cases mc ON mc.id = ma.case_id
    WHERE ma.id=$1
    FOR UPDATE
    `,
    [appealId]
  );
  const current = currentResult.rows[0];
  if (!current) return null;

  if (isTerminalAppealStatus(current.status)) {
    throw withStatus("Terminal appeals cannot be changed", 409);
  }

  if (current.status === nextStatus) {
    return getModerationAppealDetail({ client, appealId });
  }

  const sanitizedNote = sanitizeCaseNote(note);
  const result = await client.query(
    `
    UPDATE moderation_appeals
    SET status=$2,
        reviewed_by_admin=CASE
          WHEN $2 IN ('ACCEPTED', 'REJECTED') THEN $3
          ELSE reviewed_by_admin
        END,
        reviewed_at=CASE
          WHEN $2 IN ('ACCEPTED', 'REJECTED') THEN NOW()
          ELSE reviewed_at
        END,
        decision_note=CASE
          WHEN $2 IN ('ACCEPTED', 'REJECTED') THEN $4
          ELSE decision_note
        END,
        updated_at=NOW()
    WHERE id=$1
    RETURNING *
    `,
    [appealId, nextStatus, adminId, sanitizedNote]
  );
  const updated = result.rows[0];

  await recordModerationAppealEvent({
    client,
    appealId,
    caseId: updated.case_id,
    actorUserId: adminId,
    eventType: "APPEAL_STATUS_CHANGED",
    fromStatus: current.status,
    toStatus: nextStatus,
    note: sanitizedNote,
    metadata: {
      source: "admin_moderation_appeal_review",
      previous_status: current.status,
      next_status: nextStatus,
    },
  });

  await recordModerationCaseEvent({
    client,
    caseId: updated.case_id,
    actorUserId: adminId,
    eventType: "CASE_APPEAL_STATUS_CHANGED",
    fromStatus: current.case_status || null,
    toStatus: current.case_status || null,
    note: sanitizedNote,
    metadata: {
      source: "admin_moderation_appeal_review",
      appeal_id: appealId,
      appeal_from_status: current.status,
      appeal_to_status: nextStatus,
    },
  });

  return getModerationAppealDetail({ client, appealId });
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

function buildModerationCaseDetail(row, events, providerResponses = [], appeals = []) {
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
    provider_response: providerResponses[0] || null,
    provider_responses: providerResponses,
    appeal: appeals[0] || null,
    appeals,
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
  const providerResponses = await listProviderCaseResponses({ client, caseId });
  const appeals = await listModerationAppealsForCase({ client, caseId });

  return buildModerationCaseDetail(row, eventsResult.rows, providerResponses, appeals);
}

module.exports = {
  DUPLICATE_REPORT_MESSAGE,
  MAX_APPEAL_ATTACHMENTS,
  MAX_REPORT_ATTACHMENTS,
  MAX_PROVIDER_RESPONSE_ATTACHMENTS,
  MODERATION_CASE_STATUSES,
  MODERATION_APPEAL_STATUSES,
  REPORT_REASONS,
  addModerationAppealAttachments,
  addProviderCaseResponseAttachments,
  addProviderReportAttachments,
  applyProviderReportCooldown,
  createProviderReport,
  dismissProviderReport,
  getModerationCaseDetail,
  getModerationAppealDetail,
  getProviderModerationCaseDetail,
  listModerationAppeals,
  listProviderReports,
  listProviderModerationCases,
  submitProviderModerationAppeal,
  submitProviderCaseResponse,
  transitionModerationCaseStatus,
  transitionModerationAppealStatus,
  validateProviderReport,
  withdrawProviderModerationAppeal,
};
