const router = require("express").Router();
const authCtrl = require("../controllers/auth.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  authLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
} = require("../middlewares/rateLimit.middleware");

router.post("/send-otp", otpSendLimiter, authCtrl.sendOTP);
router.post("/verify-otp", otpVerifyLimiter, authCtrl.verifyOTP);
router.post("/google", authLimiter, authCtrl.googleLogin);

router.post("/set-role", authLimiter, authMiddleware, authCtrl.setRole);
router.post("/refresh-token", authLimiter, authCtrl.refreshToken);
router.post("/complete-profile", authLimiter, authMiddleware, authCtrl.completeProfile);
router.put("/update-location", authMiddleware, authCtrl.updateLocation);
router.get("/me", authMiddleware, authCtrl.getMe);
router.post("/logout", authLimiter, authCtrl.logout);

module.exports = router;
