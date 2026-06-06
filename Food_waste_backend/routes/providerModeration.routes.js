const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload");
const providerModerationCtrl = require("../controllers/providerModeration.controller");
const { reportLimiter } = require("../middlewares/rateLimit.middleware");
const { requireVerifiedProvider } = require("../middlewares/verification");

router.use(authMiddleware, requireVerifiedProvider);

router.get("/", providerModerationCtrl.listMyModerationCases);
router.get("/:id", providerModerationCtrl.getMyModerationCase);
router.post(
  "/:id/response",
  reportLimiter,
  upload.providerReportAttachments.array("attachments", 3),
  providerModerationCtrl.submitMyModerationCaseResponse
);

module.exports = router;
