const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { isValidId } = require("../utils/validation");
const {
  ensureObservabilitySchema,
  recordOperationalEvent,
} = require("../shared/services/observability.service");
const { getHealth } = require("../shared/services/health.service");
const {
  getQueueHealth,
  retryFailedJob,
} = require("../shared/services/queueObservability.service");
const { getMetricsSnapshot } = require("../shared/services/metrics.service");
const { getPaymentHealth } = require("../shared/services/paymentMonitoring.service");
const {
  dismissProviderReport,
  listProviderReports,
  validateProviderReport,
} = require("../shared/services/moderation.service");
const {
  SUBJECT_TYPES,
  getTrustEvents,
  getTrustSubject,
  isUuid,
} = require("../shared/services/trustEvent.service");

//
// 📌 GET PENDING NGOS
//
exports.getPendingNGOs = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, u.phone
      FROM ngos n
      JOIN users u ON n.user_id = u.id
      WHERE n.is_verified = false
    `);

    res.json(result.rows);

  } catch (err) {
    logger.error("Failed to fetch pending NGOs", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch NGOs" });
  }
};

//
// 📌 APPROVE NGO
//
exports.approveNGO = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ error: "NGO id is required" });
    }

    await client.query("BEGIN");

    const result = await client.query(
      `
      UPDATE ngos
      SET is_verified=true, rejection_reason=NULL
      WHERE id=$1 AND is_verified=false
      RETURNING id, user_id
      `,
      [id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "NGO not found or already approved" });
    }

    const userUpdate = await client.query(
      `
      UPDATE users
      SET role='ngo'
      WHERE id=$1
      AND role IN ('user', 'volunteer', 'ngo')
      `,
      [result.rows[0].user_id]
    );

    if (userUpdate.rowCount === 0) {
      await client.query("ROLLBACK");
      logger.security("Admin NGO approval blocked", {
        reason: "applicant_role_not_promotable",
        adminId: req.user?.id,
        ngoId: id,
        userId: result.rows[0].user_id,
      });
      return res.status(409).json({ error: "Applicant cannot be promoted to NGO" });
    }

    await client.query("COMMIT");

    logger.security("Admin approved NGO", {
      adminId: req.user?.id,
      ngoId: id,
      userId: result.rows[0].user_id,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "admin_approved_ngo",
      metadata: { adminId: req.user?.id, ngoId: id, userId: result.rows[0].user_id },
    });

    res.json({ message: "NGO approved" });

  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("NGO approval failed", { err, adminId: req.user?.id, ngoId: req.params.id });
    res.status(500).json({ error: "Approval failed" });
  } finally {
    client.release();
  }
};

//
// 📌 REJECT NGO
//
exports.rejectNGO = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: "NGO id is required" });
    }

    const rejectionReason = String(reason || "Rejected by admin").trim().slice(0, 500);
    const result = await pool.query(
      `UPDATE ngos SET is_verified=false, rejection_reason=$1 WHERE id=$2`,
      [rejectionReason || "Rejected by admin", id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "NGO not found" });
    }

    logger.security("Admin rejected NGO", { adminId: req.user?.id, ngoId: id });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "admin_rejected_ngo",
      metadata: { adminId: req.user?.id, ngoId: id },
    });

    res.json({ message: "NGO rejected" });

  } catch (err) {
    logger.error("NGO rejection failed", { err, adminId: req.user?.id, ngoId: req.params.id });
    res.status(500).json({ error: "Rejection failed" });
  }
};

//
// 📌 GET PENDING RESTAURANTS
//
exports.getPendingRestaurants = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.phone
      FROM restaurants r
      JOIN users u ON r.user_id = u.id
      WHERE r.is_verified = false
    `);

    res.json(result.rows);

  } catch (err) {
    logger.error("Failed to fetch pending restaurants", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
};

//
// 📌 APPROVE RESTAURANT
//
exports.approveRestaurant = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ error: "Restaurant id is required" });
    }

    await client.query("BEGIN");

    const result = await client.query(
      `
      UPDATE restaurants
      SET is_verified=true, rejection_reason=NULL
      WHERE id=$1 AND is_verified=false
      RETURNING id, user_id
      `,
      [id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Restaurant not found or already approved" });
    }

    const userUpdate = await client.query(
      `
      UPDATE users
      SET role='provider'
      WHERE id=$1
      AND role IN ('user', 'volunteer', 'provider')
      `,
      [result.rows[0].user_id]
    );

    if (userUpdate.rowCount === 0) {
      await client.query("ROLLBACK");
      logger.security("Admin restaurant approval blocked", {
        reason: "applicant_role_not_promotable",
        adminId: req.user?.id,
        restaurantId: id,
        userId: result.rows[0].user_id,
      });
      return res.status(409).json({ error: "Applicant cannot be promoted to provider" });
    }

    await client.query("COMMIT");

    logger.security("Admin approved restaurant", {
      adminId: req.user?.id,
      restaurantId: id,
      userId: result.rows[0].user_id,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "admin_approved_restaurant",
      metadata: { adminId: req.user?.id, restaurantId: id, userId: result.rows[0].user_id },
    });

    res.json({ message: "Restaurant approved" });

  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Restaurant approval failed", {
      err,
      adminId: req.user?.id,
      restaurantId: req.params.id,
    });
    res.status(500).json({ error: "Approval failed" });
  } finally {
    client.release();
  }
};

//
// 📌 REJECT RESTAURANT
//
exports.rejectRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: "Restaurant id is required" });
    }

    const rejectionReason = String(reason || "Rejected by admin").trim().slice(0, 500);
    const result = await pool.query(
      `UPDATE restaurants SET is_verified=false, rejection_reason=$1 WHERE id=$2`,
      [rejectionReason || "Rejected by admin", id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    logger.security("Admin rejected restaurant", {
      adminId: req.user?.id,
      restaurantId: id,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "admin_rejected_restaurant",
      metadata: { adminId: req.user?.id, restaurantId: id },
    });

    res.json({ message: "Restaurant rejected" });

  } catch (err) {
    logger.error("Restaurant rejection failed", {
      err,
      adminId: req.user?.id,
      restaurantId: req.params.id,
    });
    res.status(500).json({ error: "Rejection failed" });
  }
};

//
// GET OPERATIONAL SUMMARY
//
exports.getOperationalSummary = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM ngos) AS total_ngos,
        (SELECT COUNT(*)::int FROM restaurants) AS total_restaurants,
        (
          SELECT COUNT(*)::int
          FROM reservations
          WHERE status IN ('reserved', 'picked_up')
        ) AS active_reservations,
        (
          SELECT COUNT(*)::int
          FROM reservations
          WHERE status = 'expired'
        ) AS expired_reservations,
        (
          SELECT COUNT(DISTINCT user_id)::int
          FROM volunteers
          WHERE status = 'active'
        ) AS active_volunteers
    `);

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("Failed to fetch operational summary", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch operational summary" });
  }
};

async function getOperationalEventSummary() {
  await ensureObservabilitySchema();
  const result = await pool.query(`
    SELECT category, severity, event_name,
           COUNT(*)::int AS count,
           MAX(created_at) AS last_seen_at
    FROM operational_events
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY category, severity, event_name
    ORDER BY count DESC, last_seen_at DESC
    LIMIT 100
  `);

  return result.rows;
}

async function getReservationDiagnostics() {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE r.status='payment_pending'
        AND r.payment_status='pending'
        AND COALESCE(r.payment_expires_at, r.reserved_at + INTERVAL '10 minutes') <= NOW()
      )::int AS expired_payment_pending,
      COUNT(*) FILTER (
        WHERE r.status='payment_pending'
        AND r.payment_status='pending'
        AND r.reserved_at <= NOW() - INTERVAL '30 minutes'
      )::int AS aged_payment_pending,
      COUNT(*) FILTER (
        WHERE r.status IN ('reserved', 'payment_pending')
        AND f.pickup_end_time <= NOW()
      )::int AS pickup_window_closed_active,
      COUNT(*) FILTER (
        WHERE r.pickup_type='ngo'
        AND r.task_status='pending'
        AND r.reserved_at <= NOW() - INTERVAL '2 hours'
      )::int AS stale_ngo_task_pending,
      COUNT(*) FILTER (
        WHERE r.status='cancelled'
        AND r.payment_status='refund_pending'
      )::int AS refund_pending_cancelled
    FROM reservations r
    LEFT JOIN food_listings f ON f.id=r.listing_id
  `);

  return result.rows[0];
}

exports.getOperationalDiagnostics = async (req, res) => {
  try {
    const [health, queues, payments, events, reservations] = await Promise.all([
      getHealth({ io: req.app.get("io") }),
      getQueueHealth({ includeJobs: true }),
      getPaymentHealth(),
      getOperationalEventSummary(),
      getReservationDiagnostics(),
    ]);

    const degradedQueues = queues.filter((queue) => queue.status !== "healthy");
    const paymentIssues = {
      staleSessions: Number(payments.summary?.stale_sessions || 0),
      webhookFailures24h: Number(payments.webhooks?.failed || 0),
      reservationPaymentMismatches: Number(
        payments.diagnostics?.reservation_payment_mismatches || 0
      ),
      reconciliationAttentionRequired: Number(
        payments.diagnostics?.reconciliation_attention_required || 0
      ),
    };
    const status =
      health.status === "healthy" &&
      degradedQueues.length === 0 &&
      Object.values(paymentIssues).every((value) => value === 0)
        ? "healthy"
        : "degraded";

    res.json({
      status,
      timestamp: new Date().toISOString(),
      health,
      queues: {
        degraded: degradedQueues.length,
        total: queues.length,
        items: queues,
      },
      payments: {
        issues: paymentIssues,
        health: payments,
      },
      reservations,
      events,
      metrics: getMetricsSnapshot(),
    });
  } catch (err) {
    logger.error("Failed to fetch operational diagnostics", {
      err,
      adminId: req.user?.id,
    });
    res.status(500).json({ error: "Failed to fetch operational diagnostics" });
  }
};

exports.getOperationalMetrics = async (req, res) => {
  try {
    res.json({ metrics: getMetricsSnapshot() });
  } catch (err) {
    logger.error("Failed to fetch operational metrics", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch operational metrics" });
  }
};

//
// GET QUEUE HEALTH
//
exports.getQueueHealth = async (req, res) => {
  try {
    const queues = await getQueueHealth({ includeJobs: true });

    res.json({ queues });
  } catch (err) {
    logger.error("Failed to fetch queue health", { err, adminId: req.user?.id });
    res.status(500).json({
      success: false,
      message: "Failed to fetch queue health",
      error: "Failed to fetch queue health",
      data: null,
    });
  }
};

exports.retryFailedQueueJob = async (req, res) => {
  try {
    const job = await retryFailedJob(req.params.queueName, req.params.jobId);
    logger.security("Admin retried failed queue job", {
      adminId: req.user?.id,
      queueName: req.params.queueName,
      jobId: req.params.jobId,
    });
    void recordOperationalEvent({
      category: "queue",
      severity: "warning",
      eventName: "failed_queue_job_retried",
      metadata: {
        adminId: req.user?.id,
        queueName: req.params.queueName,
        jobId: req.params.jobId,
      },
    });
    res.json({ job });
  } catch (err) {
    logger.error("Failed to retry queue job", {
      err,
      adminId: req.user?.id,
      queueName: req.params.queueName,
      jobId: req.params.jobId,
    });
    res.status(err.statusCode || 500).json({ error: err.message || "Retry failed" });
  }
};

exports.getPaymentHealth = async (req, res) => {
  try {
    const payments = await getPaymentHealth();
    res.json({ payments });
  } catch (err) {
    logger.error("Failed to fetch payment health", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch payment health" });
  }
};

exports.getOperationalAlerts = async (req, res) => {
  try {
    await ensureObservabilitySchema();
    const result = await pool.query(`
      SELECT id, alert_key, category, severity, message, metadata, status,
             first_seen_at, last_seen_at, occurrences
      FROM operational_alerts
      WHERE status='open'
      ORDER BY severity DESC, last_seen_at DESC
      LIMIT 50
    `);
    res.json({ alerts: result.rows });
  } catch (err) {
    logger.error("Failed to fetch operational alerts", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch operational alerts" });
  }
};

exports.getSecurityEvents = async (req, res) => {
  try {
    await ensureObservabilitySchema();
    const result = await pool.query(`
      SELECT id, severity, event_name, request_id, user_id, role,
             reservation_id, metadata, created_at
      FROM operational_events
      WHERE category='security'
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json({ events: result.rows });
  } catch (err) {
    logger.error("Failed to fetch security events", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch security events" });
  }
};

function validateTrustSubjectParams(req, res) {
  const { subjectType, subjectId } = req.params;

  if (!SUBJECT_TYPES.has(subjectType) || !isUuid(subjectId)) {
    res.status(400).json({ error: "Invalid trust subject" });
    return null;
  }

  return { subjectType, subjectId };
}

exports.getTrustSubject = async (req, res) => {
  const subject = validateTrustSubjectParams(req, res);
  if (!subject) return;

  try {
    const trust = await getTrustSubject(subject);
    res.json({ subject, trust });
  } catch (err) {
    logger.error("Failed to fetch trust subject", {
      err,
      adminId: req.user?.id,
      subject,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch trust subject" });
  }
};

exports.getTrustSubjectEvents = async (req, res) => {
  const subject = validateTrustSubjectParams(req, res);
  if (!subject) return;

  try {
    const events = await getTrustEvents({
      ...subject,
      limit: req.query.limit,
    });
    res.json({ subject, events });
  } catch (err) {
    logger.error("Failed to fetch trust events", {
      err,
      adminId: req.user?.id,
      subject,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch trust events" });
  }
};

exports.getProviderReports = async (req, res) => {
  try {
    const reports = await listProviderReports({
      status: req.query.status === "all" ? null : req.query.status || "pending",
    });
    res.json({ reports });
  } catch (err) {
    logger.error("Failed to fetch provider reports", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch provider reports" });
  }
};

async function reviewProviderReport(req, res, action) {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Report id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const report =
      action === "validate"
        ? await validateProviderReport({ client, reportId: id, adminId: req.user.id })
        : await dismissProviderReport({ client, reportId: id, adminId: req.user.id });

    if (!report) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pending report not found" });
    }

    await client.query("COMMIT");
    logger.security("Provider report reviewed", {
      adminId: req.user?.id,
      reportId: id,
      action,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "provider_report_reviewed",
      metadata: { adminId: req.user?.id, reportId: id, action },
    });
    res.json({ message: `Provider report ${action}d`, report });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Provider report review failed", {
      err,
      adminId: req.user?.id,
      reportId: id,
      action,
    });
    res.status(500).json({ error: "Provider report review failed" });
  } finally {
    client.release();
  }
}

exports.validateProviderReport = (req, res) =>
  reviewProviderReport(req, res, "validate");

exports.dismissProviderReport = (req, res) =>
  reviewProviderReport(req, res, "dismiss");
