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
router.get("/operations/summary", adminCtrl.getOperationalSummary);
router.get("/operations/alerts", adminCtrl.getOperationalAlerts);
router.get("/operations/security-events", adminCtrl.getSecurityEvents);
router.get("/payments/health", adminCtrl.getPaymentHealth);
router.get("/queues/health", adminCtrl.getQueueHealth);
router.post("/queues/:queueName/jobs/:jobId/retry", adminActionLimiter, adminCtrl.retryFailedQueueJob);
router.get("/provider-reports", adminCtrl.getProviderReports);
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
