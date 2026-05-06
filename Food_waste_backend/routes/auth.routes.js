const router = require("express").Router();
const authCtrl = require("../controllers/auth.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.post("/send-otp", authCtrl.sendOTP);
router.post("/verify-otp", authCtrl.verifyOTP);

router.post("/set-role", authMiddleware, authCtrl.setRole);
router.post("/refresh-token", authCtrl.refreshToken);
router.post("/complete-profile", authCtrl.completeProfile);
router.put("/update-location", authMiddleware, authCtrl.updateLocation);
router.get("/me", authMiddleware, authCtrl.getMe);
router.post("/logout", authCtrl.logout);

module.exports = router;
