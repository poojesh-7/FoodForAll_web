const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const ratingCtrl = require("../controllers/rating.controller");
const { requireActiveAccount } = require("../middlewares/verification");

router.post("/", authMiddleware, requireActiveAccount, ratingCtrl.createRating);
router.get("/listing/:listingId", ratingCtrl.getListingRatings);
router.get("/provider/:providerId", ratingCtrl.getProviderRatings);

module.exports = router;
