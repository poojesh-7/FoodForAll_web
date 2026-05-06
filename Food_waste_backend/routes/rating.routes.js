const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const ratingCtrl = require("../controllers/rating.controller");

router.post("/", authMiddleware, ratingCtrl.createRating);
router.get("/listing/:listingId", ratingCtrl.getListingRatings);
router.get("/provider/:providerId", ratingCtrl.getProviderRatings);

module.exports = router;
