const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload");
const userCtrl = require("../controllers/user.controller");

router.get("/:id", authMiddleware, userCtrl.getUser);
router.put("/:id", authMiddleware, userCtrl.updateUser);
router.put(
  "/:id/profile-image",
  authMiddleware,
  upload.profileImage.single("profile_image"),
  userCtrl.uploadProfileImage,
);
router.delete("/:id/profile-image", authMiddleware, userCtrl.removeProfileImage);
router.get("/:id/history", authMiddleware, userCtrl.getUserHistory);

module.exports = router;
