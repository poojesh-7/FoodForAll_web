const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const foodCtrl = require("../controllers/food.controller");
const upload = require("../middlewares/upload");
const { requireVerified } = require("../middlewares/verification");
const { registrationLimiter } = require("../middlewares/rateLimit.middleware");
const {
  providerRestrictionMiddleware,
} = require("../middlewares/restriction.middleware");
// Provider only
router.post(
  "/register",
  authMiddleware,
  registrationLimiter,
  upload.single("fssai_certificate"),
  foodCtrl.registerRestaurant,
);
router.get("/me", authMiddleware, requireVerified, foodCtrl.getMyRestaurant);
router.post("/", authMiddleware, requireVerified, providerRestrictionMiddleware, foodCtrl.createFood);
router.put("/:id", authMiddleware, requireVerified, providerRestrictionMiddleware, foodCtrl.updateFood);
router.delete("/:id", authMiddleware, requireVerified, foodCtrl.deleteFood);
router.get("/ngos", authMiddleware, requireVerified, foodCtrl.viewNGOs);
router.post(
  "/:id/request-ngo",
  authMiddleware,
  requireVerified,
  providerRestrictionMiddleware,
  foodCtrl.requestNGO,
);
// Public
router.get("/", foodCtrl.getAllFood);
router.get("/active", foodCtrl.getActiveFood);
router.get("/nearby", foodCtrl.getNearbyFood);
router.get("/:id", foodCtrl.getFoodById);

module.exports = router;
