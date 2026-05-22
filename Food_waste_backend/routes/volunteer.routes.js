const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const volunteerCtrl = require("../controllers/volunteer.controller");
const {
  volunteerRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");
const { volunteerActionLimiter } = require("../middlewares/rateLimit.middleware");
const { requireVolunteer } = require("../middlewares/verification");

router.get("/available", authMiddleware, requireVolunteer, volunteerCtrl.viewAvailableNGOs);
router.get("/dashboard", authMiddleware, requireVolunteer, volunteerCtrl.getDashboard);
router.post("/join", authMiddleware, requireVolunteer, volunteerActionLimiter, volunteerCtrl.joinNGO);
router.put("/leave", authMiddleware, requireVolunteer, volunteerActionLimiter, volunteerCtrl.leaveNGO);
router.get("/requests", authMiddleware, requireVolunteer, volunteerCtrl.viewRequests);
router.put(
  "/requests/:id/respond",
  authMiddleware,
  requireVolunteer,
  volunteerActionLimiter,
  volunteerCtrl.respondToRequest,
);
router.put(
  "/tasks/:id/start",
  authMiddleware,
  requireVolunteer,
  volunteerActionLimiter,
  volunteerRestrictionMiddleware,
  volunteerCtrl.startTask
);
router.put("/tasks/:id/complete", authMiddleware, requireVolunteer, volunteerActionLimiter, volunteerCtrl.completeTask);
router.get(
  "/tasks",
  authMiddleware,
  requireVolunteer,
  volunteerRestrictionMiddleware,
  volunteerCtrl.getTasks
);

module.exports = router;
