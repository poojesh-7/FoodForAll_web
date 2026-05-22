const pool = require("../config/db");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");
const { providerDisplaySelect } = require("./providerDisplay.service");
const { recordViolation } = require("./restriction.service");
const store = require("./rateLimitStore.service");
const logger = require("../utils/logger");
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

function normalizeReason(reason) {
  return String(reason || "").trim().toLowerCase();
}

async function createProviderReport({
  client = pool,
  providerId,
  reportedBy,
  reservationId = null,
  reason,
  description = null,
}) {
  await ensureRestrictionSchema(client);
  const normalizedReason = normalizeReason(reason);

  if (!REPORT_REASONS.has(normalizedReason)) {
    const error = new Error("Invalid report reason");
    error.statusCode = 400;
    throw error;
  }

  const cooldownKey = `report:cooldown:${reportedBy}`;
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
        String(description || "").trim().slice(0, 1000) || null,
      ]
    );

    await store.set(cooldownKey, "1", REPORT_COOLDOWN_MS);
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

  await recordViolation({
    client,
    userId: report.provider_id,
    role: "provider",
    reservationId: report.reservation_id,
    reason: `Validated provider report: ${report.reason}`,
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
           f.title AS listing_title
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
    WHERE ($1::text IS NULL OR pr.status=$1)
    ORDER BY pr.created_at DESC
    `,
    [status || null]
  );
  return result.rows;
}

module.exports = {
  DUPLICATE_REPORT_MESSAGE,
  REPORT_REASONS,
  createProviderReport,
  dismissProviderReport,
  listProviderReports,
  validateProviderReport,
};
