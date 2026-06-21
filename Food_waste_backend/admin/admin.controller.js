const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { isValidId } = require("../utils/validation");
const { operationalPolicy } = require("../shared/config/operationalPolicy");
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
  getFinancialDiagnostics,
} = require("../shared/services/financialLedger.service");
const {
  listAdminProviderSettlements,
  transitionProviderSettlementStatus,
  updateProviderSettlementNotes,
} = require("../shared/services/providerPayout.service");
const {
  dismissProviderReport,
  getModerationCaseDetail,
  listModerationAppeals,
  listProviderReports,
  transitionModerationAppealStatus,
  transitionModerationCaseStatus,
  validateProviderReport,
} = require("../shared/services/moderation.service");
const {
  notifyProviderAppealStatus,
  notifyProviderModerationStatus,
} = require("../shared/services/moderationNotification.service");
const {
  notifyAdminsModerationCaseEscalated,
  notifyNgoVerificationApproved,
  notifyNgoVerificationRejected,
  notifyProviderVerificationApproved,
  notifyProviderVerificationRejected,
} = require("../shared/services/operationalNotification.service");
const {
  SUBJECT_TYPES,
  enqueueTrustProcessing,
  getTrustEvents,
  getTrustSubject,
  isUuid,
} = require("../shared/services/trustEvent.service");
const {
  getRecentTrustEvents,
  getTrustAnalytics,
  getTrustDiagnostics,
  getTrustObservabilitySummary,
  getTrustProjectionBreakdown,
} = require("../shared/services/trustObservability.service");
const {
  getTrustExplainability,
  recordAdminTrustAction: recordAdminTrustActionService,
} = require("../shared/services/trustExplainability.service");
const {
  getAbuseAnalytics,
} = require("../shared/services/abuseGuard.service");
const {
  getEscalationAnalytics,
  getGovernanceIntelligenceSummary,
  getModerationGovernanceMetrics,
  listGovernanceSignals,
  listProviderGovernanceMetrics,
  listReporterReputations,
} = require("../shared/services/governanceIntelligence.service");
const {
  getGovernanceDashboard: getGovernanceDashboardService,
} = require("../shared/services/governanceDashboard.service");
const {
  eventsToCsv,
  exportAuditEvents,
  getAuditCenter: getAuditCenterService,
} = require("../shared/services/auditCenter.service");
const {
  businessMetricsToCsv,
  exportBusinessMetrics,
  getBusinessMetrics: getBusinessMetricsService,
} = require("../shared/services/businessMetrics.service");
const {
  getOperationalMonitoring: getOperationalMonitoringService,
} = require("../shared/services/operationalMonitoring.service");
const {
  addIncidentNote,
  addIncidentPostmortem,
  assignIncident,
  createIncident,
  getIncidentDetail,
  listIncidents,
  transitionIncidentStatus,
} = require("../shared/services/incidentManagement.service");
const {
  createDeletionRequest,
  executeDeletionRequest,
  getComplianceDashboard: getComplianceDashboardService,
  getDeletionRequestDetail,
  markEvidenceArchived,
  transitionDeletionRequest,
} = require("../shared/services/compliance.service");

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

    void notifyNgoVerificationApproved({
      ngoUserId: result.rows[0].user_id,
      ngoId: result.rows[0].id,
    });

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
      `
      UPDATE ngos
      SET is_verified=false, rejection_reason=$1
      WHERE id=$2
      RETURNING id, user_id
      `,
      [rejectionReason || "Rejected by admin", id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "NGO not found" });
    }

    void notifyNgoVerificationRejected({
      ngoUserId: result.rows[0].user_id,
      ngoId: result.rows[0].id,
    });

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

    void notifyProviderVerificationApproved({
      providerId: result.rows[0].user_id,
      restaurantId: result.rows[0].id,
    });

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
      `
      UPDATE restaurants
      SET is_verified=false, rejection_reason=$1
      WHERE id=$2
      RETURNING id, user_id
      `,
      [rejectionReason || "Rejected by admin", id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    void notifyProviderVerificationRejected({
      providerId: result.rows[0].user_id,
      restaurantId: result.rows[0].id,
    });

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
  const result = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE r.status='payment_pending'
        AND r.payment_status='pending'
        AND COALESCE(
          r.payment_expires_at,
          r.reserved_at + ($1::int * INTERVAL '1 minute')
        ) <= NOW()
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
  `,
    [operationalPolicy.payment.holdTimeoutMinutes]
  );

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

exports.getOperationalMonitoring = async (req, res) => {
  try {
    const monitoring = await getOperationalMonitoringService({
      window: req.query.window,
      io: req.app.get("io"),
    });
    res.json({ monitoring });
  } catch (err) {
    logger.error("Failed to fetch operational monitoring", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(500).json({ error: "Failed to fetch operational monitoring" });
  }
};

function incidentEventMetadata(req, detail, extra = {}) {
  return {
    adminId: req.user?.id,
    incidentId: detail?.incident?.id || req.params?.id,
    status: detail?.incident?.status,
    severity: detail?.incident?.severity,
    category: detail?.incident?.category,
    ...extra,
  };
}

exports.getIncidents = async (req, res) => {
  try {
    const incidentCenter = await listIncidents({
      adminId: req.user?.id,
      filters: req.query,
    });
    res.json({ incidentCenter });
  } catch (err) {
    logger.error("Failed to fetch incident center", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch incident center",
    });
  }
};

exports.getIncident = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Incident id is required" });
  }

  try {
    const incident = await getIncidentDetail({ incidentId: id });
    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }
    res.json({ incident });
  } catch (err) {
    logger.error("Failed to fetch incident", {
      err,
      adminId: req.user?.id,
      incidentId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch incident",
    });
  }
};

exports.createIncident = async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const incident = await createIncident({
      client,
      adminId: req.user.id,
      title: req.body?.title,
      description: req.body?.description,
      severity: req.body?.severity,
      category: req.body?.category,
      assignedAdminId: req.body?.assignedAdminId || req.body?.assigned_admin_id,
      sourceType: req.body?.sourceType || req.body?.source_type,
      sourceRefId: req.body?.sourceRefId || req.body?.source_ref_id,
      sourceContext: req.body?.sourceContext || req.body?.source_context || {},
    });
    await client.query("COMMIT");

    logger.security("Incident created", {
      adminId: req.user?.id,
      incidentId: incident?.incident?.id,
      severity: incident?.incident?.severity,
      category: incident?.incident?.category,
    });
    void recordOperationalEvent({
      category: "incident",
      severity: "info",
      eventName: "incident_created",
      metadata: incidentEventMetadata(req, incident, {
        sourceType: incident?.incident?.source_type,
        sourceRefId: incident?.incident?.source_ref_id,
      }),
    });

    res.status(201).json({ incident });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Incident creation failed", {
      err,
      adminId: req.user?.id,
      title: req.body?.title,
    });
    if (err.code === "ACTIVE_INCIDENT_EXISTS") {
      return res.status(409).json({
        error: "Active incident already exists",
        code: "ACTIVE_INCIDENT_EXISTS",
        activeIncident: err.activeIncident,
      });
    }
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to create incident",
    });
  } finally {
    client.release();
  }
};

exports.updateIncidentStatus = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Incident id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const incident = await transitionIncidentStatus({
      client,
      incidentId: id,
      adminId: req.user.id,
      status: req.body?.status,
      note: req.body?.note,
    });
    if (!incident) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Incident not found" });
    }
    await client.query("COMMIT");

    logger.security("Incident status changed", {
      adminId: req.user?.id,
      incidentId: id,
      status: incident?.incident?.status,
    });
    void recordOperationalEvent({
      category: "incident",
      severity: "info",
      eventName: "incident_status_changed",
      metadata: incidentEventMetadata(req, incident, {
        requestedStatus: req.body?.status,
      }),
    });

    res.json({ incident });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Incident status update failed", {
      err,
      adminId: req.user?.id,
      incidentId: id,
      status: req.body?.status,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to update incident status",
    });
  } finally {
    client.release();
  }
};

exports.assignIncident = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Incident id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const incident = await assignIncident({
      client,
      incidentId: id,
      adminId: req.user.id,
      assignedAdminId: req.body?.assignedAdminId || req.body?.assigned_admin_id,
      note: req.body?.note,
    });
    if (!incident) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Incident not found" });
    }
    await client.query("COMMIT");

    logger.security("Incident assignment changed", {
      adminId: req.user?.id,
      incidentId: id,
      assignedAdminId: incident?.incident?.assigned_admin_id,
    });
    void recordOperationalEvent({
      category: "incident",
      severity: "info",
      eventName: "incident_assignment_changed",
      metadata: incidentEventMetadata(req, incident, {
        assignedAdminId: incident?.incident?.assigned_admin_id,
      }),
    });

    res.json({ incident });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Incident assignment failed", {
      err,
      adminId: req.user?.id,
      incidentId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to assign incident",
    });
  } finally {
    client.release();
  }
};

exports.addIncidentNote = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Incident id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const incident = await addIncidentNote({
      client,
      incidentId: id,
      adminId: req.user.id,
      note: req.body?.note,
      metadata: req.body?.metadata || {},
    });
    if (!incident) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Incident not found" });
    }
    await client.query("COMMIT");

    logger.security("Incident note added", {
      adminId: req.user?.id,
      incidentId: id,
    });
    void recordOperationalEvent({
      category: "incident",
      severity: "info",
      eventName: "incident_note_added",
      metadata: incidentEventMetadata(req, incident),
    });

    res.status(201).json({ incident });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Incident note failed", {
      err,
      adminId: req.user?.id,
      incidentId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to add incident note",
    });
  } finally {
    client.release();
  }
};

exports.addIncidentPostmortem = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Incident id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const incident = await addIncidentPostmortem({
      client,
      incidentId: id,
      adminId: req.user.id,
      rootCause: req.body?.rootCause || req.body?.root_cause,
      impactSummary: req.body?.impactSummary || req.body?.impact_summary,
      detectionMethod: req.body?.detectionMethod || req.body?.detection_method,
      resolutionSummary: req.body?.resolutionSummary || req.body?.resolution_summary,
      followUpActions: req.body?.followUpActions || req.body?.follow_up_actions,
      metadata: req.body?.metadata || {},
    });
    if (!incident) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Incident not found" });
    }
    await client.query("COMMIT");

    logger.security("Incident postmortem added", {
      adminId: req.user?.id,
      incidentId: id,
    });
    void recordOperationalEvent({
      category: "incident",
      severity: "info",
      eventName: "incident_postmortem_added",
      metadata: incidentEventMetadata(req, incident),
    });

    res.status(201).json({ incident });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Incident postmortem failed", {
      err,
      adminId: req.user?.id,
      incidentId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to add incident postmortem",
    });
  } finally {
    client.release();
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

exports.getFinancialDiagnostics = async (req, res) => {
  try {
    const diagnostics = await getFinancialDiagnostics();
    res.json({ diagnostics });
  } catch (err) {
    logger.error("Failed to fetch financial diagnostics", {
      err,
      adminId: req.user?.id,
    });
    res.status(500).json({ error: "Failed to fetch financial diagnostics" });
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

function compactAdminText(value, maxLength = 160) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
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

exports.recordTrustRecoveryCredit = async (req, res) => {
  const subject = validateTrustSubjectParams(req, res);
  if (!subject) return;

  const sourceType = compactAdminText(req.body?.sourceType || req.body?.source_type, 80) ||
    "admin_trust_recovery";
  const sourceId = compactAdminText(req.body?.sourceId || req.body?.source_id, 160);
  const reason = compactAdminText(req.body?.reason, 500);

  if (!sourceId) {
    return res.status(400).json({ error: "Recovery source id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await recordAdminTrustActionService({
      client,
      adminId: req.user?.id,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      actionType: "MANUAL_RECOVERY_CREDIT",
      reason: reason || "Admin recovery credit",
      details: {
        source_type: sourceType,
        source_id: sourceId,
        recovery_route: "blocked_actor_recovery",
      },
      idempotencyKey: `legacy_recovery:${subject.subjectType}:${subject.subjectId}:${sourceType}:${sourceId}`,
    });
    await client.query("COMMIT");

    if (!result.duplicate && result.trustEvent?.event_key) {
      void enqueueTrustProcessing(result.trustEvent.event_key).catch((err) => {
        logger.warn("Admin recovery credit enqueue failed", {
          err,
          adminId: req.user?.id,
          subject,
          actionId: result.action?.id,
        });
      });
    }

    logger.security("Admin recorded trust recovery credit", {
      adminId: req.user?.id,
      subject,
      sourceType,
      sourceId,
      inserted: result.inserted,
    });
    void recordOperationalEvent({
      category: "trust",
      severity: "info",
      eventName: "admin_trust_recovery_credit_recorded",
      metadata: {
        adminId: req.user?.id,
        subject,
        sourceType,
        sourceId,
        inserted: result.inserted,
      },
    });

    res.status(result.inserted ? 201 : 200).json({
      subject,
      recoveryEvent: {
        inserted: result.inserted,
        event: result.trustEvent,
        action: result.action,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Failed to record trust recovery credit", {
      err,
      adminId: req.user?.id,
      subject,
      sourceType,
      sourceId,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to record trust recovery credit" });
  } finally {
    client.release();
  }
};

exports.getProviderSettlementConsole = async (req, res) => {
  try {
    const settlements = await listAdminProviderSettlements({
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json({ settlements });
  } catch (err) {
    logger.error("Failed to fetch provider settlement console", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch provider settlements",
    });
  }
};

async function recordSettlementAdminEvent(req, eventName, settlement, extra = {}) {
  logger.security("Admin settlement action recorded", {
    adminId: req.user?.id,
    eventName,
    settlementId: settlement?.id || req.params?.id,
    providerId: settlement?.provider_id,
  });
  await recordOperationalEvent({
    category: "financial",
    severity: "info",
    eventName,
    metadata: {
      adminId: req.user?.id,
      settlementId: settlement?.id || req.params?.id,
      providerId: settlement?.provider_id || null,
      reservationId: settlement?.reservation_id || null,
      paymentId: settlement?.payment_id || null,
      paymentSessionId: settlement?.payment_session_id || null,
      status: settlement?.status || null,
      ...extra,
    },
  });
}

async function transitionProviderSettlementFromAdmin(req, res, status) {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Settlement id is required" });
  }

  try {
    const settlement = await transitionProviderSettlementStatus({
      settlementId: id,
      status,
      adminId: req.user.id,
      paymentReference: req.body?.payment_reference || req.body?.paymentReference,
      paidAt: req.body?.paid_at || req.body?.paidAt,
      notes: req.body?.notes,
    });

    if (!settlement) {
      return res.status(404).json({ error: "Settlement not found" });
    }

    await recordSettlementAdminEvent(
      req,
      status === "paid"
        ? "provider_settlement_marked_paid"
        : "provider_settlement_marked_failed",
      settlement,
      {
        paymentReference: settlement.payment_reference || null,
        manual_settlement: true,
        money_movement_executed_by_system: false,
      }
    );

    res.json({
      message: `Settlement marked ${status}`,
      settlement,
    });
  } catch (err) {
    logger.error("Provider settlement status update failed", {
      err,
      adminId: req.user?.id,
      settlementId: id,
      status,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to update settlement",
    });
  }
}

exports.markProviderSettlementPaid = (req, res) =>
  transitionProviderSettlementFromAdmin(req, res, "paid");

exports.markProviderSettlementFailed = (req, res) =>
  transitionProviderSettlementFromAdmin(req, res, "failed");

exports.updateProviderSettlementNotes = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Settlement id is required" });
  }

  try {
    const settlement = await updateProviderSettlementNotes({
      settlementId: id,
      adminId: req.user.id,
      notes: req.body?.notes,
    });

    if (!settlement) {
      return res.status(404).json({ error: "Settlement not found" });
    }

    await recordSettlementAdminEvent(
      req,
      "provider_settlement_notes_updated",
      settlement,
      { manual_settlement: true }
    );

    res.json({
      message: "Settlement notes updated",
      settlement,
    });
  } catch (err) {
    logger.error("Provider settlement notes update failed", {
      err,
      adminId: req.user?.id,
      settlementId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to update settlement notes",
    });
  }
};

function trustQueueSlices(queues) {
  return {
    trustQueue: queues.find((queue) => queue.name === "trust-queue") || null,
    deadLetterQueue: queues.find((queue) => queue.name === "dead-letter-queue") || null,
  };
}

exports.getTrustObservabilitySummary = async (req, res) => {
  try {
    const summary = await getTrustObservabilitySummary(req.query);
    res.json({ summary });
  } catch (err) {
    logger.error("Failed to fetch trust observability summary", {
      err,
      adminId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch trust summary" });
  }
};

exports.getRecentTrustEvents = async (req, res) => {
  try {
    const events = await getRecentTrustEvents(req.query);
    res.json(events);
  } catch (err) {
    logger.error("Failed to fetch recent trust events", {
      err,
      adminId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch recent trust events" });
  }
};

exports.getTrustProjectionBreakdown = async (req, res) => {
  const subject = validateTrustSubjectParams(req, res);
  if (!subject) return;

  try {
    const projection = await getTrustProjectionBreakdown(subject);
    res.json(projection);
  } catch (err) {
    logger.error("Failed to fetch trust projection breakdown", {
      err,
      adminId: req.user?.id,
      subject,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch trust projection" });
  }
};

exports.getTrustExplainability = async (req, res) => {
  const subject = validateTrustSubjectParams(req, res);
  if (!subject) return;

  try {
    const explanation = await getTrustExplainability({
      ...subject,
      limit: req.query.limit,
    });
    res.json({ subject, explanation });
  } catch (err) {
    logger.error("Failed to fetch trust explanation", {
      err,
      adminId: req.user?.id,
      subject,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch trust explanation" });
  }
};

exports.recordAdminTrustAction = async (req, res) => {
  const subject = validateTrustSubjectParams(req, res);
  if (!subject) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await recordAdminTrustActionService({
      client,
      adminId: req.user?.id,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      actionType: req.body?.actionType || req.body?.action_type,
      reason: req.body?.reason,
      details: req.body?.details || req.body?.actionDetails || req.body?.action_details || {},
      idempotencyKey: req.body?.idempotencyKey || req.body?.idempotency_key,
    });
    await client.query("COMMIT");

    if (!result.duplicate && result.trustEvent?.event_key) {
      void enqueueTrustProcessing(result.trustEvent.event_key).catch((err) => {
        logger.warn("Admin trust action enqueue failed", {
          err,
          adminId: req.user?.id,
          actionId: result.action?.id,
          eventKey: result.trustEvent.event_key,
        });
      });
    }

    logger.security("Admin trust action recorded", {
      adminId: req.user?.id,
      subject,
      actionId: result.action?.id,
      actionType: result.action?.action_type,
      trustEventKey: result.trustEvent?.event_key,
    });
    void recordOperationalEvent({
      category: "trust",
      severity: "info",
      eventName: "admin_trust_action_recorded",
      metadata: {
        adminId: req.user?.id,
        subject,
        actionId: result.action?.id,
        actionType: result.action?.action_type,
        trustEventKey: result.trustEvent?.event_key,
      },
    });

    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Admin trust action failed", {
      err,
      adminId: req.user?.id,
      subject,
      actionType: req.body?.actionType || req.body?.action_type,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to record admin trust action",
    });
  } finally {
    client.release();
  }
};

exports.getTrustAnalytics = async (req, res) => {
  try {
    const [analytics, abuse] = await Promise.all([
      getTrustAnalytics(req.query),
      getAbuseAnalytics(req.query),
    ]);
    res.json({ analytics: { ...analytics, abuse } });
  } catch (err) {
    logger.error("Failed to fetch trust analytics", {
      err,
      adminId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch trust analytics" });
  }
};

exports.getTrustDiagnostics = async (req, res) => {
  try {
    const [diagnostics, queues] = await Promise.all([
      getTrustDiagnostics(req.query),
      getQueueHealth({ includeJobs: true }),
    ]);
    res.json({
      diagnostics: {
        ...diagnostics,
        queue: {
          ...diagnostics.queue,
          ...trustQueueSlices(queues),
        },
      },
    });
  } catch (err) {
    logger.error("Failed to fetch trust diagnostics", {
      err,
      adminId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch trust diagnostics" });
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

exports.getModerationCase = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Moderation case id is required" });
  }

  try {
    const moderationCase = await getModerationCaseDetail({ caseId: id });
    if (!moderationCase) {
      return res.status(404).json({ error: "Moderation case not found" });
    }

    res.json({ case: moderationCase });
  } catch (err) {
    logger.error("Failed to fetch moderation case", {
      err,
      adminId: req.user?.id,
      caseId: id,
    });
    res.status(err.statusCode || 500).json({ error: "Failed to fetch moderation case" });
  }
};

exports.getModerationAppeals = async (req, res) => {
  try {
    const appeals = await listModerationAppeals({
      status: req.query.status || "open",
    });
    res.json({ appeals });
  } catch (err) {
    logger.error("Failed to fetch moderation appeals", {
      err,
      adminId: req.user?.id,
      status: req.query.status,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch moderation appeals",
    });
  }
};

exports.getGovernanceIntelligence = async (req, res) => {
  try {
    const intelligence = await getGovernanceIntelligenceSummary(req.query);
    res.json({ intelligence });
  } catch (err) {
    logger.error("Failed to fetch governance intelligence", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch governance intelligence",
    });
  }
};

exports.getGovernanceDashboard = async (req, res) => {
  try {
    const dashboard = await getGovernanceDashboardService(req.query);
    res.json({ dashboard });
  } catch (err) {
    logger.error("Failed to fetch governance dashboard", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch governance dashboard",
    });
  }
};

exports.getGovernanceReporterReputation = async (req, res) => {
  try {
    const reporters = await listReporterReputations(req.query);
    res.json({ reporters });
  } catch (err) {
    logger.error("Failed to fetch reporter reputation intelligence", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch reporter reputation",
    });
  }
};

exports.getGovernanceProviderMetrics = async (req, res) => {
  try {
    const providers = await listProviderGovernanceMetrics(req.query);
    res.json({ providers });
  } catch (err) {
    logger.error("Failed to fetch provider governance intelligence", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch provider governance metrics",
    });
  }
};

exports.getGovernanceSignals = async (req, res) => {
  try {
    const signals = await listGovernanceSignals(req.query);
    res.json({ signals });
  } catch (err) {
    logger.error("Failed to fetch governance signals", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch governance signals",
    });
  }
};

exports.getGovernanceMetrics = async (req, res) => {
  try {
    const metrics = await getModerationGovernanceMetrics(req.query);
    res.json({ metrics });
  } catch (err) {
    logger.error("Failed to fetch governance metrics", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch governance metrics",
    });
  }
};

exports.getGovernanceEscalations = async (req, res) => {
  try {
    const escalation = await getEscalationAnalytics(req.query);
    res.json({ escalation });
  } catch (err) {
    logger.error("Failed to fetch governance escalation analytics", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch governance escalations",
    });
  }
};

exports.getAuditCenter = async (req, res) => {
  try {
    const audit = await getAuditCenterService(req.query);
    res.json({ audit });
  } catch (err) {
    logger.error("Failed to fetch audit center", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch audit center",
    });
  }
};

exports.exportAuditCenterJson = async (req, res) => {
  try {
    const auditExport = await exportAuditEvents(req.query);
    res.setHeader("Content-Disposition", "attachment; filename=\"audit-center-export.json\"");
    res.json(auditExport);
  } catch (err) {
    logger.error("Failed to export audit center JSON", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to export audit center JSON",
    });
  }
};

exports.exportAuditCenterCsv = async (req, res) => {
  try {
    const auditExport = await exportAuditEvents(req.query);
    res.setHeader("Content-Disposition", "attachment; filename=\"audit-center-export.csv\"");
    res.type("text/csv").send(eventsToCsv(auditExport.events));
  } catch (err) {
    logger.error("Failed to export audit center CSV", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to export audit center CSV",
    });
  }
};

exports.getBusinessMetrics = async (req, res) => {
  try {
    const metrics = await getBusinessMetricsService(req.query);
    res.json({ metrics });
  } catch (err) {
    logger.error("Failed to fetch business metrics", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch business metrics",
    });
  }
};

async function recordBusinessMetricsExport(req, format, exported) {
  logger.security("Business metrics exported", {
    adminId: req.user?.id,
    format,
    period: exported?.filters?.period,
  });
  await recordOperationalEvent({
    category: "governance",
    severity: "info",
    eventName: "business_metrics_exported",
    metadata: {
      adminId: req.user?.id,
      format,
      period: exported?.filters?.period,
      window: exported?.window,
      source: "business_metrics",
      informational_only: true,
      export_auditable: true,
    },
  });
}

exports.exportBusinessMetricsJson = async (req, res) => {
  try {
    const metricsExport = await exportBusinessMetrics(req.query);
    await recordBusinessMetricsExport(req, "json", metricsExport);
    res.setHeader("Content-Disposition", "attachment; filename=\"business-metrics-export.json\"");
    res.json(metricsExport);
  } catch (err) {
    logger.error("Failed to export business metrics JSON", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to export business metrics JSON",
    });
  }
};

exports.exportBusinessMetricsCsv = async (req, res) => {
  try {
    const metricsExport = await exportBusinessMetrics(req.query);
    await recordBusinessMetricsExport(req, "csv", metricsExport);
    res.setHeader("Content-Disposition", "attachment; filename=\"business-metrics-export.csv\"");
    res.type("text/csv").send(businessMetricsToCsv(metricsExport.metrics));
  } catch (err) {
    logger.error("Failed to export business metrics CSV", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to export business metrics CSV",
    });
  }
};

function recordComplianceOperationalEvent(req, eventName, metadata = {}) {
  logger.security("Compliance action recorded", {
    adminId: req.user?.id,
    eventName,
    ...metadata,
  });
  void recordOperationalEvent({
    category: "compliance",
    severity: "info",
    eventName,
    metadata: {
      adminId: req.user?.id,
      ...metadata,
    },
  });
}

exports.getComplianceDashboard = async (req, res) => {
  try {
    const compliance = await getComplianceDashboardService(req.query);
    res.json({ compliance });
  } catch (err) {
    logger.error("Failed to fetch compliance dashboard", {
      err,
      adminId: req.user?.id,
      query: req.query,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch compliance dashboard",
    });
  }
};

exports.getComplianceDeletionRequest = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Deletion request id is required" });
  }

  try {
    const request = await getDeletionRequestDetail({ requestId: id });
    if (!request) {
      return res.status(404).json({ error: "Deletion request not found" });
    }
    res.json({ request });
  } catch (err) {
    logger.error("Failed to fetch compliance deletion request", {
      err,
      adminId: req.user?.id,
      requestId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch deletion request",
    });
  }
};

exports.createComplianceDeletionRequest = async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const request = await createDeletionRequest({
      client,
      adminId: req.user.id,
      requestType: req.body?.requestType || req.body?.request_type,
      subjectType: req.body?.subjectType || req.body?.subject_type,
      subjectId: req.body?.subjectId || req.body?.subject_id,
      targetUserId: req.body?.targetUserId || req.body?.target_user_id,
      reason: req.body?.reason,
      legalHold: req.body?.legalHold || req.body?.legal_hold,
      policyKey: req.body?.policyKey || req.body?.policy_key,
      metadata: req.body?.metadata || {},
    });
    await client.query("COMMIT");

    recordComplianceOperationalEvent(req, "compliance_deletion_request_created", {
      requestId: request?.request?.id,
      requestType: request?.request?.request_type,
      subjectType: request?.request?.subject_type,
      subjectId: request?.request?.subject_id,
    });

    res.status(201).json({ request });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Compliance deletion request creation failed", {
      err,
      adminId: req.user?.id,
      body: req.body,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to create deletion request",
      code: err.code,
      activeRequest: err.activeRequest,
    });
  } finally {
    client.release();
  }
};

async function transitionComplianceRequest(req, res, status) {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Deletion request id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const request = await transitionDeletionRequest({
      client,
      requestId: id,
      adminId: req.user.id,
      status,
      note: req.body?.note,
    });
    if (!request) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Deletion request not found" });
    }
    await client.query("COMMIT");

    recordComplianceOperationalEvent(req, `compliance_deletion_request_${status.toLowerCase()}`, {
      requestId: id,
      status,
      requestType: request?.request?.request_type,
      subjectType: request?.request?.subject_type,
      subjectId: request?.request?.subject_id,
    });

    res.json({ request });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Compliance deletion request transition failed", {
      err,
      adminId: req.user?.id,
      requestId: id,
      status,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to update deletion request",
    });
  } finally {
    client.release();
  }
}

exports.reviewComplianceDeletionRequest = (req, res) =>
  transitionComplianceRequest(req, res, "UNDER_REVIEW");

exports.approveComplianceDeletionRequest = (req, res) =>
  transitionComplianceRequest(req, res, "APPROVED");

exports.rejectComplianceDeletionRequest = (req, res) =>
  transitionComplianceRequest(req, res, "REJECTED");

exports.executeComplianceDeletionRequest = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Deletion request id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const request = await executeDeletionRequest({
      client,
      requestId: id,
      adminId: req.user.id,
      note: req.body?.note,
    });
    if (!request) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Deletion request not found" });
    }
    await client.query("COMMIT");

    recordComplianceOperationalEvent(req, "compliance_deletion_request_executed", {
      requestId: id,
      requestType: request?.request?.request_type,
      subjectType: request?.request?.subject_type,
      subjectId: request?.request?.subject_id,
    });

    res.json({ request });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Compliance deletion request execution failed", {
      err,
      adminId: req.user?.id,
      requestId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to execute deletion request",
    });
  } finally {
    client.release();
  }
};

exports.archiveComplianceEvidence = async (req, res) => {
  const { evidenceType, id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: "Evidence id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const evidence = await markEvidenceArchived({
      client,
      adminId: req.user.id,
      evidenceType,
      evidenceId: id,
      reason: req.body?.reason,
    });
    await client.query("COMMIT");

    recordComplianceOperationalEvent(req, "compliance_evidence_archived", {
      evidenceType,
      evidenceId: id,
    });

    res.json({ evidence });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Compliance evidence archival failed", {
      err,
      adminId: req.user?.id,
      evidenceType,
      evidenceId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to archive evidence",
    });
  } finally {
    client.release();
  }
};

async function reviewModerationAppeal(req, res, status) {
  const { id } = req.params;
  const note = req.body?.note;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Appeal id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const appeal = await transitionModerationAppealStatus({
      client,
      appealId: id,
      adminId: req.user.id,
      status,
      note,
    });

    if (!appeal) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Appeal not found" });
    }

    const moderationCase = await getModerationCaseDetail({
      client,
      caseId: appeal.case_id,
    });

    await client.query("COMMIT");

    void notifyProviderAppealStatus({
      providerId: appeal.provider_id,
      caseId: appeal.case_id,
      appealId: appeal.id,
      status: appeal.status,
    });

    logger.security("Moderation appeal reviewed", {
      adminId: req.user?.id,
      appealId: id,
      caseId: appeal.case_id,
      status: appeal.status,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "moderation_appeal_reviewed",
      metadata: {
        adminId: req.user?.id,
        appealId: id,
        caseId: appeal.case_id,
        status: appeal.status,
      },
    });

    res.json({
      message: `Appeal moved to ${appeal.status}`,
      appeal,
      case: moderationCase,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Moderation appeal review failed", {
      err,
      adminId: req.user?.id,
      appealId: id,
      status,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Moderation appeal review failed",
    });
  } finally {
    client.release();
  }
}

exports.reviewModerationAppeal = (req, res) =>
  reviewModerationAppeal(req, res, "UNDER_REVIEW");

exports.acceptModerationAppeal = (req, res) =>
  reviewModerationAppeal(req, res, "ACCEPTED");

exports.rejectModerationAppeal = (req, res) =>
  reviewModerationAppeal(req, res, "REJECTED");

exports.updateModerationCaseStatus = async (req, res) => {
  const { id } = req.params;
  const status = req.body?.status;
  const note = req.body?.note;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Moderation case id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentDetail = await getModerationCaseDetail({ client, caseId: id });
    if (!currentDetail) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Moderation case not found" });
    }

    if (
      ["VALIDATED", "DISMISSED"].includes(String(status || "").toUpperCase()) &&
      currentDetail.report?.id &&
      currentDetail.report.status === "pending"
    ) {
      if (String(status).toUpperCase() === "VALIDATED") {
        await validateProviderReport({
          client,
          reportId: currentDetail.report.id,
          adminId: req.user.id,
          note,
        });
      } else {
        await dismissProviderReport({
          client,
          reportId: currentDetail.report.id,
          adminId: req.user.id,
          note,
        });
      }
    } else {
      const updated = await transitionModerationCaseStatus({
        client,
        caseId: id,
        adminId: req.user.id,
        status,
        note,
        metadata: {
          source: "admin_case_status_update",
        },
      });

      if (!updated) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Moderation case not found" });
      }
    }

    const moderationCase = await getModerationCaseDetail({ client, caseId: id });
    await client.query("COMMIT");

    if (
      moderationCase &&
      currentDetail.status !== moderationCase.status &&
      moderationCase.subject_type === "provider"
    ) {
      void notifyProviderModerationStatus({
        providerId: moderationCase.subject_id,
        caseId: moderationCase.id,
        status: moderationCase.status,
      });
      if (moderationCase.status === "ESCALATED") {
        void notifyAdminsModerationCaseEscalated({
          caseId: moderationCase.id,
          providerId: moderationCase.subject_id,
        });
      }
    }

    logger.security("Moderation case status updated", {
      adminId: req.user?.id,
      caseId: id,
      status,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "moderation_case_status_updated",
      metadata: { adminId: req.user?.id, caseId: id, status },
    });

    res.json({ message: "Moderation case updated", case: moderationCase });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Moderation case update failed", {
      err,
      adminId: req.user?.id,
      caseId: id,
      status,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Moderation case update failed",
    });
  } finally {
    client.release();
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
        ? await validateProviderReport({
            client,
            reportId: id,
            adminId: req.user.id,
            note: req.body?.note,
          })
        : await dismissProviderReport({
            client,
            reportId: id,
            adminId: req.user.id,
            note: req.body?.note,
          });

    if (!report) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pending report not found" });
    }

    await client.query("COMMIT");
    void notifyProviderModerationStatus({
      providerId: report.provider_id,
      caseId: report.moderation_case_id,
      status: report.moderation_case_status,
    });
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
