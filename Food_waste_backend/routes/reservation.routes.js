const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const reservationCtrl = require("../controllers/reservation.controller");

router.post("/", authMiddleware, reservationCtrl.createReservation);
router.get("/my", authMiddleware, reservationCtrl.getMyReservations);
router.get("/:id", authMiddleware, reservationCtrl.getReservationById);
router.put("/:id/cancel", authMiddleware, reservationCtrl.cancelReservation);
router.put("/:id/pickup", authMiddleware, reservationCtrl.markAsPickedUp);

module.exports = router;
