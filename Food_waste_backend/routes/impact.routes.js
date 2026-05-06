const router = require("express").Router();
const impactCtrl = require("../controllers/impact.controller");

router.get("/summary", impactCtrl.getSummary);
router.get("/user/:id", impactCtrl.getUserImpact);
router.get("/listing/:id", impactCtrl.getListingImpact);
router.get("/ngo/:id", impactCtrl.getNGOImpact);

module.exports = router;
