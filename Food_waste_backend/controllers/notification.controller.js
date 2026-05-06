const pool = require("../shared/config/db");
const { isValidId } = require("../utils/validation");

exports.getNotifications = async (req, res) => {
  const result = await pool.query(
    `
    SELECT *
    FROM notifications
    WHERE user_id=$1
    ORDER BY created_at DESC
    `,
    [req.user.id],
  );

  res.json(result.rows);
};

exports.markAsRead = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Notification id is required" });
  }

  const result = await pool.query(
    `
    UPDATE notifications
    SET is_read=true
    WHERE id=$1 AND user_id=$2
    RETURNING *
    `,
    [id, req.user.id],
  );

  if (!result.rows.length)
    return res.status(404).json({ error: "Notification not found" });

  res.json(result.rows[0]);
};

exports.getUnreadCount = async (req, res) => {
  const result = await pool.query(
    `
    SELECT COUNT(*) AS unread_count
    FROM notifications
    WHERE user_id=$1 AND is_read=false
    `,
    [req.user.id],
  );

  res.json({ unread: parseInt(result.rows[0].unread_count) });
};

exports.markAllAsRead = async (req, res) => {
  await pool.query(
    `
    UPDATE notifications
    SET is_read=true
    WHERE user_id=$1 AND is_read=false
    `,
    [req.user.id],
  );

  res.json({ message: "All notifications marked as read" });
};
