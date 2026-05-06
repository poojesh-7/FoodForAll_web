const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const ngoCtrl = require("../controllers/ngo.controller");
const { requireVerified } = require("../middlewares/verification");
router.post("/register", authMiddleware, ngoCtrl.registerNGO);
router.get("/me", authMiddleware, requireVerified, ngoCtrl.getMyNGO);
router.get(
  "/listings/nearby",
  authMiddleware,
  requireVerified,
  ngoCtrl.getNearbyListings,
);
router.post(
  "/bulk-reserve",
  authMiddleware,
  requireVerified,
  ngoCtrl.bulkReserve,
);
router.get(
  "/reservations",
  authMiddleware,
  requireVerified,
  ngoCtrl.getMyReservations
);
router.get(
  "/volunteers/assigned",
  authMiddleware,
  requireVerified,
  ngoCtrl.viewVolunteers,
);
router.get(
  "/volunteers",
  authMiddleware,
  requireVerified,
  ngoCtrl.viewUnassignedVolunteers,
);
router.post(
  "/request-volunteer",
  authMiddleware,
  requireVerified,
  ngoCtrl.requestVolunteer,
);
router.put("/urgent", authMiddleware, requireVerified, ngoCtrl.setUrgent);
router.get(
  "/requests",
  authMiddleware,
  requireVerified,
  ngoCtrl.viewIncomingRequests,
);
router.put(
  "/requests/:requestID/accept",
  authMiddleware,
  requireVerified,
  ngoCtrl.acceptNGORequest,
);
router.put(
  "/requests/:requestID/reject",
  authMiddleware,
  requireVerified,
  ngoCtrl.rejectRequest,
);

module.exports = router;
