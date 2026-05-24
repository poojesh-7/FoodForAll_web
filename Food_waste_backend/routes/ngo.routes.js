const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const ngoCtrl = require("../controllers/ngo.controller");
const {
  requireActiveAccount,
  requireVerifiedNGO,
} = require("../middlewares/verification");
const {
  ngoBulkReserveLimiter,
  ngoRequestLimiter,
  paymentLimiter,
  registrationLimiter,
} = require("../middlewares/rateLimit.middleware");
const {
  reservationRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");

router.post("/register", authMiddleware, requireActiveAccount, registrationLimiter, ngoCtrl.registerNGO);
router.get("/me", authMiddleware, ngoCtrl.getMyNGO);
router.get(
  "/listings/nearby",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.getNearbyListings,
);
router.post(
  "/bulk-reserve",
  authMiddleware,
  ngoBulkReserveLimiter,
  paymentLimiter,
  requireVerifiedNGO,
  reservationRestrictionMiddleware,
  ngoCtrl.bulkReserve,
);
router.post(
  "/bulk-reserve/preview",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.previewBulkReserve,
);
router.get(
  "/reservations",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.getMyReservations
);
router.get(
  "/volunteers/assigned",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.viewVolunteers,
);
router.get(
  "/volunteers",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.viewUnassignedVolunteers,
);
router.post(
  "/request-volunteer",
  authMiddleware,
  ngoRequestLimiter,
  requireVerifiedNGO,
  ngoCtrl.requestVolunteer,
);
router.get(
  "/volunteer-join-requests",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.viewVolunteerJoinRequests,
);
router.put(
  "/volunteer-join-requests/:requestID/approve",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.approveVolunteerJoinRequest,
);
router.put(
  "/volunteer-join-requests/:requestID/reject",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.rejectVolunteerJoinRequest,
);
router.put("/urgent", authMiddleware, requireVerifiedNGO, ngoCtrl.setUrgent);
router.get(
  "/requests",
  authMiddleware,
  requireVerifiedNGO,
  ngoCtrl.viewIncomingRequests,
);
router.put(
  "/requests/:requestID/accept",
  authMiddleware,
  ngoRequestLimiter,
  paymentLimiter,
  requireVerifiedNGO,
  reservationRestrictionMiddleware,
  ngoCtrl.acceptNGORequest,
);
router.put(
  "/requests/:requestID/reject",
  authMiddleware,
  ngoRequestLimiter,
  requireVerifiedNGO,
  ngoCtrl.rejectRequest,
);

module.exports = router;
