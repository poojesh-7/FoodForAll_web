const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const foodCtrl = require("../controllers/food.controller");
const upload = require("../middlewares/upload");
const {
  requireActiveAccount,
  requireVerifiedProvider,
} = require("../middlewares/verification");
const {
  listingCreateLimiter,
  ngoRequestLimiter,
  registrationLimiter,
} = require("../middlewares/rateLimit.middleware");
const {
  providerRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");
// Provider only
router.post(
  "/register",
  authMiddleware,
  requireActiveAccount,
  registrationLimiter,
  upload.single("fssai_certificate"),
  foodCtrl.registerRestaurant,
);
router.get("/me", authMiddleware, requireVerifiedProvider, foodCtrl.getMyRestaurant);
router.post("/", authMiddleware, listingCreateLimiter, requireVerifiedProvider, providerRestrictionMiddleware, foodCtrl.createFood);
router.put("/:id", authMiddleware, listingCreateLimiter, requireVerifiedProvider, providerRestrictionMiddleware, foodCtrl.updateFood);
router.delete("/:id", authMiddleware, requireVerifiedProvider, foodCtrl.deleteFood);
router.get("/ngos", authMiddleware, requireVerifiedProvider, foodCtrl.viewNGOs);
router.post(
  "/:id/request-ngo",
  authMiddleware,
  ngoRequestLimiter,
  requireVerifiedProvider,
  providerRestrictionMiddleware,
  foodCtrl.requestNGO,
);
// Public
router.get("/", foodCtrl.getAllFood);
router.get("/active", foodCtrl.getActiveFood);
router.get("/nearby", foodCtrl.getNearbyFood);
router.get("/:id", foodCtrl.getFoodById);

module.exports = router;
