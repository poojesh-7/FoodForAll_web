const router = require("express").Router();
const authCtrl = require("../controllers/auth.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { authLimiter } = require("../middlewares/rateLimit.middleware");

router.post("/send-otp", authLimiter, authCtrl.sendOTP);
router.post("/verify-otp", authLimiter, authCtrl.verifyOTP);

router.post("/set-role", authLimiter, authMiddleware, authCtrl.setRole);
router.post("/refresh-token", authLimiter, authCtrl.refreshToken);
router.post("/complete-profile", authLimiter, authCtrl.completeProfile);
router.put("/update-location", authMiddleware, authCtrl.updateLocation);
router.get("/me", authMiddleware, authCtrl.getMe);
router.post("/logout", authLimiter, authCtrl.logout);

module.exports = router;
