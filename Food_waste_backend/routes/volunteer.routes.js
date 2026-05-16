const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const volunteerCtrl = require("../controllers/volunteer.controller");
const {
  volunteerRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");

router.get("/available", authMiddleware, volunteerCtrl.viewAvailableNGOs);
router.get("/dashboard", authMiddleware, volunteerCtrl.getDashboard);
router.post("/join", authMiddleware, volunteerCtrl.joinNGO);
router.put("/leave", authMiddleware, volunteerCtrl.leaveNGO);
router.get("/requests", authMiddleware, volunteerCtrl.viewRequests);
router.put(
  "/requests/:id/respond",
  authMiddleware,
  volunteerCtrl.respondToRequest,
);
router.put(
  "/tasks/:id/start",
  authMiddleware,
  volunteerRestrictionMiddleware,
  volunteerCtrl.startTask
);
router.put("/tasks/:id/complete", authMiddleware, volunteerCtrl.completeTask);
router.get(
  "/tasks",
  authMiddleware,
  volunteerRestrictionMiddleware,
  volunteerCtrl.getTasks
);

module.exports = router;
