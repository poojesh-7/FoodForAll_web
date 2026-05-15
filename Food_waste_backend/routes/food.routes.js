const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const foodCtrl = require("../controllers/food.controller");
const upload = require("../middlewares/upload");
const { requireVerified } = require("../middlewares/verification");
const { registrationLimiter } = require("../middlewares/rateLimit.middleware");
// Provider only
router.post(
  "/register",
  authMiddleware,
  registrationLimiter,
  upload.single("fssai_certificate"),
  foodCtrl.registerRestaurant,
);
router.get("/me", authMiddleware, requireVerified, foodCtrl.getMyRestaurant);
router.post("/", authMiddleware, requireVerified, foodCtrl.createFood);
router.put("/:id", authMiddleware, requireVerified, foodCtrl.updateFood);
router.delete("/:id", authMiddleware, requireVerified, foodCtrl.deleteFood);
router.get("/ngos", authMiddleware, requireVerified, foodCtrl.viewNGOs);
router.post(
  "/:id/request-ngo",
  authMiddleware,
  requireVerified,
  foodCtrl.requestNGO,
);
// Public
router.get("/", foodCtrl.getAllFood);
router.get("/active", foodCtrl.getActiveFood);
router.get("/nearby", foodCtrl.getNearbyFood);
router.get("/:id", foodCtrl.getFoodById);

module.exports = router;
