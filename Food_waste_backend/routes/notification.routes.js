const router = require("express").Router();
const authMiddleware = require("../middlewares/auth.middleware");
const notificationCtrl = require("../controllers/notification.controller");
const pool = require("../shared/config/db");
const { isProvided } = require("../utils/validation");

router.get("/", authMiddleware, notificationCtrl.getNotifications);
router.put("/:id/read", authMiddleware, notificationCtrl.markAsRead);
router.get("/count/unread", authMiddleware, notificationCtrl.getUnreadCount);
router.put("/read-all", authMiddleware, notificationCtrl.markAllAsRead);

router.post("/save-token", authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;

    if (!isProvided(token)) {
      return res.status(400).json({ error: "Token is required" });
    }

    await pool.query(`UPDATE users SET fcm_token=$1 WHERE id=$2`, [
      token,
      req.user.id,
    ]);

    res.json({ message: "Token saved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save token" });
  }
});

module.exports = router;
