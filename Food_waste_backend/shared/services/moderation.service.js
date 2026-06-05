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

function normalizeReason(reason) {
  return sanitizePlainText(reason, { maxLength: 80 }).toLowerCase();
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
    const report = await client.query(
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
    return report.rows[0];
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

async function validateProviderReport({ client = pool, reportId, adminId }) {
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

  await recordProviderReportValidated({
    client,
    report,
  });

  return report;
}

async function dismissProviderReport({ client = pool, reportId, adminId }) {
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

  return result.rows[0] || null;
}

async function listProviderReports({ client = pool, status = "pending" } = {}) {
  await ensureRestrictionSchema(client);
  const result = await client.query(
    `
    SELECT pr.*,
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
    WHERE ($1::text IS NULL OR pr.status=$1)
    ORDER BY pr.created_at DESC
    `,
    [status || null]
  );
  return result.rows;
}

module.exports = {
  DUPLICATE_REPORT_MESSAGE,
  MAX_REPORT_ATTACHMENTS,
  REPORT_REASONS,
  addProviderReportAttachments,
  applyProviderReportCooldown,
  createProviderReport,
  dismissProviderReport,
  listProviderReports,
  validateProviderReport,
};
