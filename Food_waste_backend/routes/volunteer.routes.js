const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const volunteerCtrl = require("../controllers/volunteer.controller");
const {
  volunteerRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");
const { volunteerActionLimiter } = require("../middlewares/rateLimit.middleware");

router.get("/available", authMiddleware, volunteerCtrl.viewAvailableNGOs);
router.get("/dashboard", authMiddleware, volunteerCtrl.getDashboard);
router.post("/join", authMiddleware, volunteerActionLimiter, volunteerCtrl.joinNGO);
router.put("/leave", authMiddleware, volunteerActionLimiter, volunteerCtrl.leaveNGO);
router.get("/requests", authMiddleware, volunteerCtrl.viewRequests);
router.put(
  "/requests/:id/respond",
  authMiddleware,
  volunteerActionLimiter,
  volunteerCtrl.respondToRequest,
);
router.put(
  "/tasks/:id/start",
  authMiddleware,
  volunteerActionLimiter,
  volunteerRestrictionMiddleware,
  volunteerCtrl.startTask
);
router.put("/tasks/:id/complete", authMiddleware, volunteerActionLimiter, volunteerCtrl.completeTask);
router.get(
  "/tasks",
  authMiddleware,
  volunteerRestrictionMiddleware,
  volunteerCtrl.getTasks
);

module.exports = router;
