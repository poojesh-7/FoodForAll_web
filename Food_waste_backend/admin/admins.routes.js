const express = require("express");
const router = express.Router();
const adminCtrl = require("./admin.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const requireAdmin = require("../middlewares/admin.middleware");
const { adminActionLimiter } = require("../middlewares/rateLimit.middleware");

router.use(authMiddleware, requireAdmin);

router.get("/ngos/pending", adminCtrl.getPendingNGOs);
router.patch("/ngos/:id/approve", adminActionLimiter, adminCtrl.approveNGO);
router.patch("/ngos/:id/reject", adminActionLimiter, adminCtrl.rejectNGO);

router.get("/restaurants/pending", adminCtrl.getPendingRestaurants);
router.patch("/restaurants/:id/approve", adminActionLimiter, adminCtrl.approveRestaurant);
router.patch("/restaurants/:id/reject", adminActionLimiter, adminCtrl.rejectRestaurant);
router.get("/operations/diagnostics", adminCtrl.getOperationalDiagnostics);
router.get("/operations/monitoring", adminCtrl.getOperationalMonitoring);
router.get("/operations/metrics", adminCtrl.getOperationalMetrics);
router.get("/operations/summary", adminCtrl.getOperationalSummary);
router.get("/operations/alerts", adminCtrl.getOperationalAlerts);
router.get("/operations/security-events", adminCtrl.getSecurityEvents);
router.get("/payments/health", adminCtrl.getPaymentHealth);
router.get("/payments/financial-diagnostics", adminCtrl.getFinancialDiagnostics);
router.get("/queues/health", adminCtrl.getQueueHealth);
router.post("/queues/:queueName/jobs/:jobId/retry", adminActionLimiter, adminCtrl.retryFailedQueueJob);
router.get("/trust/summary", adminCtrl.getTrustObservabilitySummary);
router.get("/trust/events", adminCtrl.getRecentTrustEvents);
router.get("/trust/analytics", adminCtrl.getTrustAnalytics);
router.get("/trust/diagnostics", adminCtrl.getTrustDiagnostics);
router.post(
  "/trust/:subjectType/:subjectId/recovery-credit",
  adminActionLimiter,
  adminCtrl.recordTrustRecoveryCredit,
);
router.get("/trust/:subjectType/:subjectId/projection", adminCtrl.getTrustProjectionBreakdown);
router.get("/trust/:subjectType/:subjectId/explain", adminCtrl.getTrustExplainability);
router.post(
  "/trust/:subjectType/:subjectId/actions",
  adminActionLimiter,
  adminCtrl.recordAdminTrustAction,
);
router.get("/trust/:subjectType/:subjectId", adminCtrl.getTrustSubject);
router.get("/trust/:subjectType/:subjectId/events", adminCtrl.getTrustSubjectEvents);
router.get("/provider-reports", adminCtrl.getProviderReports);
router.get("/governance-dashboard", adminCtrl.getGovernanceDashboard);
router.get("/governance-intelligence", adminCtrl.getGovernanceIntelligence);
router.get(
  "/governance-intelligence/reporters",
  adminCtrl.getGovernanceReporterReputation,
);
router.get(
  "/governance-intelligence/providers",
  adminCtrl.getGovernanceProviderMetrics,
);
router.get("/governance-intelligence/signals", adminCtrl.getGovernanceSignals);
router.get("/governance-intelligence/metrics", adminCtrl.getGovernanceMetrics);
router.get(
  "/governance-intelligence/escalations",
  adminCtrl.getGovernanceEscalations,
);
router.get("/audit-center", adminCtrl.getAuditCenter);
router.get("/audit-center/export.json", adminCtrl.exportAuditCenterJson);
router.get("/audit-center/export.csv", adminCtrl.exportAuditCenterCsv);
router.get("/business-metrics", adminCtrl.getBusinessMetrics);
router.get("/business-metrics/export.json", adminCtrl.exportBusinessMetricsJson);
router.get("/business-metrics/export.csv", adminCtrl.exportBusinessMetricsCsv);
router.get("/incidents", adminCtrl.getIncidents);
router.post("/incidents", adminActionLimiter, adminCtrl.createIncident);
router.get("/incidents/:id", adminCtrl.getIncident);
router.patch(
  "/incidents/:id/status",
  adminActionLimiter,
  adminCtrl.updateIncidentStatus,
);
router.patch(
  "/incidents/:id/assignment",
  adminActionLimiter,
  adminCtrl.assignIncident,
);
router.post(
  "/incidents/:id/notes",
  adminActionLimiter,
  adminCtrl.addIncidentNote,
);
router.post(
  "/incidents/:id/postmortem",
  adminActionLimiter,
  adminCtrl.addIncidentPostmortem,
);
router.get("/moderation-cases/:id", adminCtrl.getModerationCase);
router.get("/moderation-appeals", adminCtrl.getModerationAppeals);
router.patch(
  "/moderation-appeals/:id/review",
  adminActionLimiter,
  adminCtrl.reviewModerationAppeal,
);
router.patch(
  "/moderation-appeals/:id/accept",
  adminActionLimiter,
  adminCtrl.acceptModerationAppeal,
);
router.patch(
  "/moderation-appeals/:id/reject",
  adminActionLimiter,
  adminCtrl.rejectModerationAppeal,
);
router.patch(
  "/moderation-cases/:id/status",
  adminActionLimiter,
  adminCtrl.updateModerationCaseStatus,
);
router.patch(
  "/provider-reports/:id/validate",
  adminActionLimiter,
  adminCtrl.validateProviderReport,
);
router.patch(
  "/provider-reports/:id/dismiss",
  adminActionLimiter,
  adminCtrl.dismissProviderReport,
);

module.exports = router;
