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

router.post(
  "/",
  reservationCreateLimiter,
  authMiddleware,
  reservationRestrictionMiddleware,
  reservationCtrl.createReservation
);
router.post("/preview", authMiddleware, reservationCtrl.previewReservation);
router.get("/my", authMiddleware, reservationCtrl.getMyReservations);
router.get("/provider", authMiddleware, reservationCtrl.getProviderReservations);
router.get("/:id", authMiddleware, reservationCtrl.getReservationById);
router.put("/:id/cancel", authMiddleware, reservationCtrl.cancelReservation);
router.put("/:id/pickup", authMiddleware, reservationCtrl.markAsPickedUp);
router.post("/:id/report-provider", reportLimiter, authMiddleware, reservationCtrl.reportProvider);

module.exports = router;
