const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const reservationCtrl = require("../controllers/reservation.controller");
const { reservationCreateLimiter } = require("../middlewares/rateLimit.middleware");

router.post("/", reservationCreateLimiter, authMiddleware, reservationCtrl.createReservation);
router.get("/my", authMiddleware, reservationCtrl.getMyReservations);
router.get("/provider", authMiddleware, reservationCtrl.getProviderReservations);
router.get("/:id", authMiddleware, reservationCtrl.getReservationById);
router.put("/:id/cancel", authMiddleware, reservationCtrl.cancelReservation);
router.put("/:id/pickup", authMiddleware, reservationCtrl.markAsPickedUp);

module.exports = router;
