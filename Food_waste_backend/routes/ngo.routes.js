const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const ngoCtrl = require("../controllers/ngo.controller");
const { requireVerified } = require("../middlewares/verification");
const {
  registrationLimiter,
  reservationCreateLimiter,
} = require("../middlewares/rateLimit.middleware");
const {
  reservationRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");

router.post("/register", authMiddleware, registrationLimiter, ngoCtrl.registerNGO);
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
  reservationCreateLimiter,
  requireVerified,
  reservationRestrictionMiddleware,
  ngoCtrl.bulkReserve,
);
router.post(
  "/bulk-reserve/preview",
  authMiddleware,
  requireVerified,
  ngoCtrl.previewBulkReserve,
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
router.get(
  "/volunteer-join-requests",
  authMiddleware,
  requireVerified,
  ngoCtrl.viewVolunteerJoinRequests,
);
router.put(
  "/volunteer-join-requests/:requestID/approve",
  authMiddleware,
  requireVerified,
  ngoCtrl.approveVolunteerJoinRequest,
);
router.put(
  "/volunteer-join-requests/:requestID/reject",
  authMiddleware,
  requireVerified,
  ngoCtrl.rejectVolunteerJoinRequest,
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
  reservationRestrictionMiddleware,
  ngoCtrl.acceptNGORequest,
);
router.put(
  "/requests/:requestID/reject",
  authMiddleware,
  requireVerified,
  ngoCtrl.rejectRequest,
);

module.exports = router;
