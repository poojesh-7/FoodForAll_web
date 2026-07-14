const pool = require("../config/db");
const logger = require("../utils/logger");
const { formatBrowserPushNotification } = require("./notificationFormatter");

let webpushClient = null;

function getWebPushClient() {
  if (webpushClient) {
    return webpushClient;
  }

  try {
    webpushClient = require("web-push");
  } catch (error) {
    logger.warn("Browser push client unavailable", {
      error: error?.message || error,
    });
    webpushClient = false;
  }

  return webpushClient;
}

function isWebPushEnabled() {
  const raw = String(process.env.WEB_PUSH_ENABLED || "false").trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(raw);
}

function getWebPushConfig() {
  return {
    enabled: isWebPushEnabled(),
    vapidPublicKey:
      process.env.VAPID_PUBLIC_KEY || process.env.PUSH_VAPID_PUBLIC_KEY || null,
    vapidPrivateKey:
      process.env.VAPID_PRIVATE_KEY || process.env.PUSH_VAPID_PRIVATE_KEY || null,
    vapidSubject:
      process.env.VAPID_SUBJECT || process.env.PUSH_VAPID_SUBJECT || null,
  };
}

function configureWebPush() {
  const client = getWebPushClient();
  if (!client) {
    return false;
  }

  const config = getWebPushConfig();
  if (!config.vapidPrivateKey || !config.vapidPublicKey || !config.vapidSubject) {
    return false;
  }

  client.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  return true;
}

function buildPushPayload(notification, extraData = {}) {
  const payload = formatBrowserPushNotification(notification, extraData);

  return {
    ...payload,
    renotify: true,
    requireInteraction: false,
  };
}

async function deactivateSubscription(subscriptionId, userId, reason) {
  if (!subscriptionId) return false;

  const result = await pool.query(
    `
    UPDATE web_push_subscriptions
    SET active = FALSE, updated_at = NOW(), revoked_at = NOW()
    WHERE id=$1 AND user_id=$2 AND active = TRUE
    RETURNING id
    `,
    [subscriptionId, userId]
  );

  if (!result.rows.length) {
    return false;
  }

  logger.info("Browser subscription deactivated", {
    userId,
    subscriptionId,
    reason,
  });
  return true;
}

async function sendBrowserPushNotification(notification, data = {}) {
  if (!isWebPushEnabled()) {
    logger.info("Browser push skipped", {
      reason: "disabled",
      notificationId: notification?.id,
      userId: notification?.user_id,
    });
    return { skipped: true, reason: "disabled", deliveredCount: 0 };
  }

  if (!configureWebPush()) {
    logger.warn("Browser push skipped", {
      reason: "missing-config",
      notificationId: notification?.id,
      userId: notification?.user_id,
    });
    return { skipped: true, reason: "missing-config", deliveredCount: 0 };
  }

  const subscriptions = await listSubscriptionsForUser(notification?.user_id);
  if (!subscriptions.length) {
    logger.info("Browser push skipped (no active subscriptions)", {
      notificationId: notification?.id,
      userId: notification?.user_id,
    });
    return { skipped: true, reason: "no-active-subscriptions", deliveredCount: 0 };
  }

  const payload = JSON.stringify(buildPushPayload(notification, data));
  let deliveredCount = 0;

  const client = getWebPushClient();
  if (!client) {
    logger.warn("Browser push skipped", {
      reason: "client-unavailable",
      notificationId: notification?.id,
      userId: notification?.user_id,
    });
    return { skipped: true, reason: "client-unavailable", deliveredCount: 0 };
  }

  for (const subscription of subscriptions) {
    try {
      await client.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload
      );
      deliveredCount += 1;
    } catch (error) {
      const statusCode = error?.statusCode;
      const reason = statusCode === 404 || statusCode === 410 || error?.message?.includes("subscription")
        ? "invalid-subscription"
        : "delivery-failed";

      if (statusCode === 404 || statusCode === 410 || error?.message?.includes("subscription")) {
        await deactivateSubscription(subscription.id, notification?.user_id, reason);
      }

      logger.warn("Browser push failed", {
        notificationId: notification?.id,
        userId: notification?.user_id,
        subscriptionId: subscription.id,
        statusCode,
        reason,
      });
    }
  }

  logger.info("Browser push sent", {
    notificationId: notification?.id,
    userId: notification?.user_id,
    deliveredCount,
    subscriptionCount: subscriptions.length,
  });

  return { skipped: false, reason: null, deliveredCount };
}

function isSubscriptionPayloadValid(payload) {
  if (!payload || typeof payload !== "object") return false;

  const normalized = normalizeSubscriptionPayload(payload);
  
  if (!normalized.endpoint) return false;
  if (!normalized.p256dh || !normalized.auth) return false;

  try {
    const endpoint = new URL(normalized.endpoint);
    return endpoint.protocol === "https:" || endpoint.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeSubscriptionPayload(input = {}) {
  const source =
    input && typeof input === "object" && input.subscription && typeof input.subscription === "object"
      ? input.subscription
      : input;

  const keys = source.keys && typeof source.keys === "object" ? source.keys : {};
  const endpoint = String(source.endpoint || "").trim();

  return {
    endpoint,
    p256dh: String(keys.p256dh || "").trim(),
    auth: String(keys.auth || "").trim(),
    userAgent: String(input.userAgent || input.user_agent || "").trim() || null,
  };
}

async function listSubscriptionsForUser(userId) {
  const result = await pool.query(
    `
    SELECT id, endpoint, p256dh, auth, user_agent, active, created_at, updated_at
    FROM web_push_subscriptions
    WHERE user_id=$1  AND active = TRUE
    ORDER BY created_at DESC, id DESC
    `,
    [userId]
  );

  return result.rows || [];
}

async function upsertSubscriptionForUser(userId, payload) {
    if (!isSubscriptionPayloadValid(payload)) {
      const error = new Error("Invalid browser push subscription payload");
      error.statusCode = 400;
      throw error;
    }

    const normalized = normalizeSubscriptionPayload(payload);

  const result = await pool.query(
    `
    INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    ON CONFLICT (user_id, endpoint)
    DO UPDATE SET
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = COALESCE(EXCLUDED.user_agent, web_push_subscriptions.user_agent),
      active = TRUE,
      updated_at = NOW(),
      last_used_at = NOW()
    RETURNING id, user_id, endpoint, p256dh, auth, user_agent, active, created_at, updated_at
    `,
    [userId, normalized.endpoint, normalized.p256dh, normalized.auth, normalized.userAgent]
  );

  logger.info("Browser push subscription upserted", {
    userId,
    endpoint: normalized.endpoint,
    enabled: isWebPushEnabled(),
  });

  return result.rows[0];
}

async function deleteSubscriptionForUser(userId, subscriptionId) {
  const result = await pool.query(
    `
    UPDATE web_push_subscriptions
    SET
        active = FALSE,
        revoked_at = NOW(),
        updated_at = NOW()
    WHERE
        user_id = $1
        AND id = $2
        AND active = TRUE
    RETURNING id;
    `,
    [userId, subscriptionId]
  );

  if (!result.rows.length) {
    logger.warn("Browser push subscription delete missed", {
      userId,
      subscriptionId,
    });
    return false;
  }

  logger.info("Browser push subscription deactivated", {
    userId,
    subscriptionId,
  });
  return true;
}

async function deactivateSubscriptionsForUser(userId) {
  const result = await pool.query(
    `
    UPDATE web_push_subscriptions
    SET active = FALSE, updated_at = NOW()
    WHERE user_id=$1
    RETURNING id
    `,
    [userId]
  );

  logger.info("Browser push subscriptions deactivated", {
    userId,
    count: result.rowCount || 0,
  });

  return result.rowCount || 0;
}

async function cleanupInactiveSubscriptions() {
  const result = await pool.query(
    `
    DELETE FROM web_push_subscriptions
    WHERE active = FALSE
    `
  );

  logger.info("Browser push subscriptions cleanup complete", {
    deletedCount: result.rowCount || 0,
  });

  return result.rowCount || 0;
}

module.exports = {
  buildPushPayload,
  cleanupInactiveSubscriptions,
  deactivateSubscriptionsForUser,
  deleteSubscriptionForUser,
  getWebPushConfig,
  isSubscriptionPayloadValid,
  isWebPushEnabled,
  listSubscriptionsForUser,
  normalizeSubscriptionPayload,
  sendBrowserPushNotification,
  upsertSubscriptionForUser,
};
