const pool = require("../config/db");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");
const { recordViolation } = require("./restriction.service");

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

  const existing = await client.query(
    `
    SELECT id
    FROM provider_reports
    WHERE provider_id=$1
    AND reported_by=$2
    AND reservation_id=$3
    AND status='pending'
    LIMIT 1
    `,
    [providerId, reportedBy, reservationId]
  );

  if (existing.rows.length) {
    const error = new Error(DUPLICATE_REPORT_MESSAGE);
    error.statusCode = 409;
    throw error;
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
           COALESCE(restaurant.restaurant_name, provider.name) AS provider_name,
           COALESCE(reporter_ngo.organization_name, reporter.name) AS reporter_name,
           reporter.role AS reporter_role,
           r.pickup_type AS reservation_pickup_type,
           r.status AS reservation_status,
           r.task_status AS reservation_task_status,
           f.title AS listing_title
    FROM provider_reports pr
    JOIN users provider ON provider.id = pr.provider_id
    JOIN users reporter ON reporter.id = pr.reported_by
    LEFT JOIN restaurants restaurant ON restaurant.user_id = provider.id
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
