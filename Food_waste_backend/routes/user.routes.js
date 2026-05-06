const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const userCtrl = require("../controllers/user.controller");

router.get("/:id", authMiddleware, userCtrl.getUser);
router.put("/:id", authMiddleware, userCtrl.updateUser);
router.get("/:id/history", authMiddleware, userCtrl.getUserHistory);

module.exports = router;
