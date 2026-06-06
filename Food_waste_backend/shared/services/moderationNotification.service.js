const pool = require("../config/db");
const logger = require("../utils/logger");

const PROVIDER_STATUS_NOTIFICATIONS = {
  AWAITING_RESPONSE: {
    type: "moderation_case_awaiting_response",
    message: "Moderation case requires your response.",
  },
  VALIDATED: {
    type: "moderation_case_validated",
    message: "Moderation case has been validated.",
  },
  DISMISSED: {
    type: "moderation_case_dismissed",
    message: "Moderation case has been dismissed.",
  },
};

const PROVIDER_APPEAL_STATUS_NOTIFICATIONS = {
  UNDER_REVIEW: {
    type: "moderation_appeal_under_review",
    message: "Your appeal is under review.",
  },
  ACCEPTED: {
    type: "moderation_appeal_accepted",
    message: "Your appeal has been accepted.",
  },
  REJECTED: {
    type: "moderation_appeal_rejected",
    message: "Your appeal has been rejected.",
  },
};

function getNotificationQueue() {
  return require("../../queues/notification.queue");
}

function getPublishSocketEvent() {
  return require("./realtime.service").publishSocketEvent;
}

function moderationNotificationData({
  action,
  caseId,
  status = null,
  responseId = null,
  appealId = null,
  attachmentCount = null,
}) {
  const data = {
    action,
    case_id: caseId,
    status,
    response_id: responseId,
    attachment_count: attachmentCount,
    href: caseId ? `/provider/moderation-cases/${caseId}` : undefined,
  };
  if (appealId !== null && appealId !== undefined) {
    data.appeal_id = appealId;
  }
  return data;
}

async function enqueueNotification({
  userId,
  type,
  title = "Moderation update",
  message,
  data = {},
  queue = null,
}) {
  if (!userId) return null;

  const activeQueue = queue || getNotificationQueue();
  return activeQueue.add("notify-user", {
    userId,
    type,
    title,
    message,
    data,
  });
}

async function publishModerationCaseUpdated({
  userIds,
  action,
  caseId,
  status = null,
  responseId = null,
  appealId = null,
  attachmentCount = null,
  publish = null,
}) {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];
  const activePublish = publish || getPublishSocketEvent();
  const payload = {
    action,
    case_id: caseId,
    status,
    response_id: responseId,
    attachment_count: attachmentCount,
  };
  if (appealId !== null && appealId !== undefined) {
    payload.appeal_id = appealId;
  }
  await Promise.all(
    uniqueUserIds.map((userId) =>
      activePublish(`user:${userId}`, "moderation_case_updated", payload)
    )
  );
}

async function getAdminUserIds({ client = pool } = {}) {
  const result = await client.query(
    `
    SELECT id
    FROM users
    WHERE role='admin'
    AND is_verified=true
    AND (banned_until IS NULL OR banned_until < NOW())
    `
  );

  return result.rows.map((row) => row.id);
}

async function notifyProviderModerationStatus({
  providerId,
  caseId,
  status,
  queue = null,
  publish = null,
}) {
  const normalizedStatus = String(status || "").toUpperCase();
  const config = PROVIDER_STATUS_NOTIFICATIONS[normalizedStatus];

  if (!config || !providerId || !caseId) return null;

  const data = moderationNotificationData({
    action: "case_status_changed",
    caseId,
    status: normalizedStatus,
  });

  try {
    await enqueueNotification({
      userId: providerId,
      type: config.type,
      message: config.message,
      data,
      queue,
    });
    await publishModerationCaseUpdated({
      userIds: [providerId],
      action: "case_status_changed",
      caseId,
      status: normalizedStatus,
      publish,
    });
  } catch (err) {
    logger.warn("Provider moderation notification failed", {
      err,
      providerId,
      caseId,
      status: normalizedStatus,
    });
  }

  return data;
}

async function notifyAdminsProviderResponseSubmitted({
  caseId,
  providerId,
  responseId,
  attachmentCount = 0,
  client = pool,
  queue = null,
  publish = null,
}) {
  if (!caseId || !providerId || !responseId) return [];

  let adminIds = [];
  try {
    adminIds = await getAdminUserIds({ client });
  } catch (err) {
    logger.warn("Admin lookup for moderation notification failed", {
      err,
      caseId,
      providerId,
    });
    return [];
  }

  const data = moderationNotificationData({
    action: "provider_response_submitted",
    caseId,
    responseId,
    attachmentCount,
  });

  await Promise.all(
    adminIds.map((adminId) =>
      enqueueNotification({
        userId: adminId,
        type: "moderation_provider_response_submitted",
        message: "Provider responded to moderation case.",
        data: {
          ...data,
          href: `/admin/moderation-cases/${caseId}`,
        },
        queue,
      }).catch((err) => {
        logger.warn("Admin moderation notification enqueue failed", {
          err,
          adminId,
          caseId,
          providerId,
        });
      })
    )
  );

  await publishModerationCaseUpdated({
    userIds: adminIds,
    action: "provider_response_submitted",
    caseId,
    responseId,
    attachmentCount,
    publish,
  }).catch((err) => {
    logger.warn("Admin moderation realtime publish failed", {
      err,
      caseId,
      providerId,
    });
  });

  return adminIds;
}

async function notifyAdminsAppealSubmitted({
  caseId,
  providerId,
  appealId,
  attachmentCount = 0,
  client = pool,
  queue = null,
  publish = null,
}) {
  if (!caseId || !providerId || !appealId) return [];

  let adminIds = [];
  try {
    adminIds = await getAdminUserIds({ client });
  } catch (err) {
    logger.warn("Admin lookup for appeal notification failed", {
      err,
      caseId,
      providerId,
      appealId,
    });
    return [];
  }

  const data = moderationNotificationData({
    action: "appeal_submitted",
    caseId,
    appealId,
    attachmentCount,
  });

  await Promise.all(
    adminIds.map((adminId) =>
      enqueueNotification({
        userId: adminId,
        type: "moderation_appeal_submitted",
        message: "Provider submitted an appeal.",
        data: {
          ...data,
          href: `/admin/moderation-cases/${caseId}`,
        },
        queue,
      }).catch((err) => {
        logger.warn("Admin appeal notification enqueue failed", {
          err,
          adminId,
          caseId,
          providerId,
          appealId,
        });
      })
    )
  );

  await publishModerationCaseUpdated({
    userIds: adminIds,
    action: "appeal_submitted",
    caseId,
    appealId,
    attachmentCount,
    publish,
  }).catch((err) => {
    logger.warn("Admin appeal realtime publish failed", {
      err,
      caseId,
      providerId,
      appealId,
    });
  });

  return adminIds;
}

async function notifyAdminsAppealWithdrawn({
  caseId,
  providerId,
  appealId,
  client = pool,
  queue = null,
  publish = null,
}) {
  if (!caseId || !providerId || !appealId) return [];

  let adminIds = [];
  try {
    adminIds = await getAdminUserIds({ client });
  } catch (err) {
    logger.warn("Admin lookup for appeal withdrawal notification failed", {
      err,
      caseId,
      providerId,
      appealId,
    });
    return [];
  }

  const data = moderationNotificationData({
    action: "appeal_withdrawn",
    caseId,
    appealId,
    status: "WITHDRAWN",
  });

  await Promise.all(
    adminIds.map((adminId) =>
      enqueueNotification({
        userId: adminId,
        type: "moderation_appeal_withdrawn",
        message: "Provider withdrew a moderation appeal.",
        data: {
          ...data,
          href: `/admin/moderation-cases/${caseId}`,
        },
        queue,
      }).catch((err) => {
        logger.warn("Admin appeal withdrawal notification enqueue failed", {
          err,
          adminId,
          caseId,
          providerId,
          appealId,
        });
      })
    )
  );

  await publishModerationCaseUpdated({
    userIds: adminIds,
    action: "appeal_withdrawn",
    caseId,
    status: "WITHDRAWN",
    appealId,
    publish,
  }).catch((err) => {
    logger.warn("Admin appeal withdrawal realtime publish failed", {
      err,
      caseId,
      providerId,
      appealId,
    });
  });

  return adminIds;
}

async function notifyProviderAppealStatus({
  providerId,
  caseId,
  appealId,
  status,
  queue = null,
  publish = null,
}) {
  const normalizedStatus = String(status || "").toUpperCase();
  const config = PROVIDER_APPEAL_STATUS_NOTIFICATIONS[normalizedStatus];

  if (!config || !providerId || !caseId || !appealId) return null;

  const data = moderationNotificationData({
    action: "appeal_status_changed",
    caseId,
    appealId,
    status: normalizedStatus,
  });

  try {
    await enqueueNotification({
      userId: providerId,
      type: config.type,
      message: config.message,
      data,
      queue,
    });
    await publishModerationCaseUpdated({
      userIds: [providerId],
      action: "appeal_status_changed",
      caseId,
      appealId,
      status: normalizedStatus,
      publish,
    });
  } catch (err) {
    logger.warn("Provider appeal notification failed", {
      err,
      providerId,
      caseId,
      appealId,
      status: normalizedStatus,
    });
  }

  return data;
}

module.exports = {
  getAdminUserIds,
  notifyAdminsAppealSubmitted,
  notifyAdminsAppealWithdrawn,
  notifyAdminsProviderResponseSubmitted,
  notifyProviderAppealStatus,
  notifyProviderModerationStatus,
  publishModerationCaseUpdated,
};
