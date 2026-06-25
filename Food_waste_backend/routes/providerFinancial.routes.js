const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const providerFinancialCtrl = require("../controllers/providerFinancial.controller");
const { requireVerifiedProvider } = require("../middlewares/verification");

router.use(authMiddleware, requireVerifiedProvider);

router.get("/payout-account", providerFinancialCtrl.getMyPayoutAccounts);
router.post("/payout-account", providerFinancialCtrl.replaceMyPayoutAccount);
router.delete(
  "/payout-account",
  providerFinancialCtrl.deactivateMyPayoutAccount,
);
router.post(
  "/payout-account/change-request",
  providerFinancialCtrl.requestPayoutAccountChange,
);
router.get("/settlements", providerFinancialCtrl.getMySettlementSummary);

module.exports = router;
