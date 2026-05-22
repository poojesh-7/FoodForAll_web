const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const reservationCtrl = require("../controllers/reservation.controller");
const {
  reportLimiter,
  reservationCreateLimiter,
} = require("../middlewares/rateLimit.middleware");
const {
  reservationRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");
const {
  requireActiveAccount,
  requireVerifiedProvider,
  requireUser,
} = require("../middlewares/verification");

router.post(
  "/",
  reservationCreateLimiter,
  authMiddleware,
  requireUser,
  reservationRestrictionMiddleware,
  reservationCtrl.createReservation
);
router.post("/preview", authMiddleware, requireUser, reservationCtrl.previewReservation);
router.get("/my", authMiddleware, requireActiveAccount, reservationCtrl.getMyReservations);
router.get("/provider", authMiddleware, requireVerifiedProvider, reservationCtrl.getProviderReservations);
router.get("/:id", authMiddleware, requireActiveAccount, reservationCtrl.getReservationById);
router.put("/:id/cancel", authMiddleware, requireActiveAccount, reservationCtrl.cancelReservation);
router.put("/:id/pickup", authMiddleware, requireVerifiedProvider, reservationCtrl.markAsPickedUp);
router.post("/:id/report-provider", reportLimiter, authMiddleware, requireActiveAccount, reservationCtrl.reportProvider);

module.exports = router;
