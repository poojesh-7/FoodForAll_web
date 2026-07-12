const pool = require("../shared/config/db");
const { isValidId } = require("../utils/validation");
const webPushService = require("../shared/services/webPush.service");

const DEFAULT_NOTIFICATION_LIMIT = 30;
const MAX_NOTIFICATION_LIMIT = 100;

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeLimit(value) {
  return Math.max(
    1,
    Math.min(toInt(value, DEFAULT_NOTIFICATION_LIMIT), MAX_NOTIFICATION_LIMIT)
  );
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeCursor(cursor) {
  if (!cursor) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8")
    );
    const createdAt = normalizeTimestamp(decoded?.created_at);
    const id = String(decoded?.id || "").trim();
    if (!createdAt || !isValidId(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(row) {
  if (!row?.id || !row?.created_at) return null;
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;

  return Buffer.from(
    JSON.stringify({
      created_at: createdAt,
      id: row.id,
    })
  ).toString("base64url");
}

exports.getNotifications = async (req, res) => {
  const limit = normalizeLimit(req.query?.limit);
  const cursor = decodeCursor(req.query?.cursor);
  const params = [req.user.id];
  let cursorSql = "";

  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    cursorSql = `
      AND (
        created_at < $2::timestamptz
        OR (created_at = $2::timestamptz AND id < $3::uuid)
      )
    `;
  }

  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  const result = await pool.query(
    `
    SELECT *
    FROM notifications
    WHERE user_id=$1
    ${cursorSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limitParam}
    `,
    params,
  );

  const rows = result.rows || [];
  const pageRows = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : null;

  res.set("X-Notification-Limit", String(limit));
  res.set("X-Has-More", rows.length > limit ? "true" : "false");
  if (nextCursor) {
    res.set("X-Next-Cursor", nextCursor);
  }

  res.json(pageRows);
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

exports.listBrowserPushSubscriptions = async (req, res) => {
  try {
    const subscriptions = await webPushService.listSubscriptionsForUser(req.user.id);
    res.json({ subscriptions });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to list subscriptions" });
  }
};

exports.createBrowserPushSubscription = async (req, res) => {
  try {
    const subscription = await webPushService.upsertSubscriptionForUser(req.user.id, req.body);
    res.status(201).json({ subscription });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to save subscription" });
  }
};

exports.deleteBrowserPushSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ error: "Subscription id is required" });
    }

    const deleted = await webPushService.deleteSubscriptionForUser(req.user.id, id);
    if (!deleted) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    res.json({ message: "Subscription removed" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to delete subscription" });
  }
};
