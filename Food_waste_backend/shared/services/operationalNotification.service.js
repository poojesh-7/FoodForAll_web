const pool = require("../config/db");
const logger = require("../utils/logger");

function getNotificationQueue() {
  return require("../../queues/notification.queue");
}

function getPublishSocketEvent() {
  return require("./realtime.service").publishSocketEvent;
}

async function enqueueNotification({
  userId,
  type,
  title = "Operational update",
  message,
  data = {},
  idempotencyKey = null,
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
    idempotencyKey,
  });
}

function formatSettlementAmount(value, currency = "INR") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

async function getAdminUserIds({ client = pool } = {}) {
  const result = await client.query(
    `
    SELECT id
    FROM users
    WHERE role='admin'
    AND is_verified=true
    AND (banned_until IS NULL OR banned_until < NOW())
    `,
  );

  return result.rows.map((row) => row.id);
}

async function notifyAdmins({
  type,
  title = "Operational update",
  message,
  data = {},
  idempotencyKeyPrefix = null,
  client = pool,
  queue = null,
  logContext = {},
}) {
  let adminIds = [];
  try {
    adminIds = await getAdminUserIds({ client });
  } catch (err) {
    logger.warn("Admin lookup for operational notification failed", {
      err,
      ...logContext,
    });
    return [];
  }

  await Promise.all(
    adminIds.map((adminId) =>
      enqueueNotification({
        userId: adminId,
        type,
        title,
        message,
        data,
        idempotencyKey: idempotencyKeyPrefix
          ? `${idempotencyKeyPrefix}:admin:${adminId}`
          : null,
        queue,
      }).catch((err) => {
        logger.warn("Admin operational notification enqueue failed", {
          err,
          adminId,
          type,
          ...logContext,
        });
      }),
    ),
  );

  return adminIds;
}

async function publishProviderFinancialUpdated({
  userIds,
  action,
  providerId,
  payoutAccountId = null,
  previousPayoutAccountId = null,
  settlementId = null,
  status = null,
  publish = null,
}) {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];
  if (!uniqueUserIds.length || !action) return [];

  const activePublish = publish || getPublishSocketEvent();
  const payload = {
    action,
    provider_id: providerId || null,
    payout_account_id: payoutAccountId || null,
    previous_payout_account_id: previousPayoutAccountId || null,
    settlement_id: settlementId || null,
    status: status || null,
  };

  await Promise.all(
    uniqueUserIds.map((userId) =>
      activePublish(`user:${userId}`, "provider_financial_updated", payload),
    ),
  );

  return uniqueUserIds;
}

async function notifyAdminsProviderVerificationSubmitted({
  providerId,
  restaurantId,
  client = pool,
  queue = null,
}) {
  return notifyAdmins({
    type: "provider_verification_submitted",
    message: "New provider verification request pending review.",
    data: {
      provider_id: providerId,
      restaurant_id: restaurantId,
      href: "/admin/restaurants",
    },
    client,
    queue,
    logContext: { providerId, restaurantId },
  });
}

async function notifyAdminsNgoVerificationSubmitted({
  ngoId,
  ngoUserId,
  client = pool,
  queue = null,
}) {
  return notifyAdmins({
    type: "ngo_verification_submitted",
    message: "New NGO verification request pending review.",
    data: {
      ngo_id: ngoId,
      ngo_user_id: ngoUserId,
      href: "/admin/ngos",
    },
    client,
    queue,
    logContext: { ngoId, ngoUserId },
  });
}

async function notifyAdminsProviderReportSubmitted({
  reportId,
  caseId,
  providerId,
  reporterId,
  client = pool,
  queue = null,
}) {
  return notifyAdmins({
    type: "provider_report_submitted",
    message: "New provider report awaiting moderation review.",
    data: {
      report_id: reportId,
      case_id: caseId,
      provider_id: providerId,
      reporter_id: reporterId,
      href: caseId
        ? `/admin/moderation-cases/${caseId}`
        : "/admin/provider-reports",
    },
    client,
    queue,
    logContext: { reportId, caseId, providerId, reporterId },
  });
}

async function notifyAdminsModerationCaseEscalated({
  caseId,
  providerId,
  client = pool,
  queue = null,
}) {
  return notifyAdmins({
    type: "moderation_case_escalated",
    message: "Moderation case escalated for review.",
    data: {
      case_id: caseId,
      provider_id: providerId,
      href: `/admin/moderation-cases/${caseId}`,
    },
    client,
    queue,
    logContext: { caseId, providerId },
  });
}

async function notifyAdminsProviderPayoutAccountSubmitted({
  providerId,
  payoutAccountId,
  previousPayoutAccountId = null,
  isReplacement = false,
  client = pool,
  queue = null,
  publish = null,
}) {
  if (!providerId || !payoutAccountId) return [];

  const type = isReplacement
    ? "provider_payout_account_replacement_uploaded"
    : "provider_payout_account_submitted";
  const action = type;
  const adminIds = await notifyAdmins({
    type,
    title: isReplacement
      ? "Replacement payout account uploaded"
      : "Payout account submitted",
    message: isReplacement
      ? "Provider uploaded replacement payout account details for review."
      : "Provider submitted payout account details for review.",
    data: {
      action,
      provider_id: providerId,
      payout_account_id: payoutAccountId,
      previous_payout_account_id: previousPayoutAccountId || null,
      href: "/admin/settlements",
    },
    idempotencyKeyPrefix: `${type}:${payoutAccountId}`,
    client,
    queue,
    logContext: { providerId, payoutAccountId, previousPayoutAccountId },
  });

  await publishProviderFinancialUpdated({
    userIds: adminIds,
    action,
    providerId,
    payoutAccountId,
    previousPayoutAccountId,
    publish,
  }).catch((err) => {
    logger.warn("Admin payout account realtime publish failed", {
      err,
      providerId,
      payoutAccountId,
    });
  });

  return adminIds;
}

async function notifyAdminsProviderPayoutChangeRequested({
  providerId,
  payoutAccountId,
  reason,
  client = pool,
  queue = null,
  publish = null,
}) {
  if (!providerId || !payoutAccountId) return [];

  const action = "provider_payout_change_requested";
  const adminIds = await notifyAdmins({
    type: "provider_payout_change_requested",
    title: "Payout account change requested",
    message: "Provider requested a payout account change.",
    data: {
      action,
      provider_id: providerId,
      payout_account_id: payoutAccountId,
      reason: reason || null,
      href: "/admin/settlements",
    },
    idempotencyKeyPrefix: `provider_payout_change_requested:${payoutAccountId}`,
    client,
    queue,
    logContext: { providerId, payoutAccountId },
  });

  await publishProviderFinancialUpdated({
    userIds: adminIds,
    action,
    providerId,
    payoutAccountId,
    publish,
  }).catch((err) => {
    logger.warn("Admin payout change realtime publish failed", {
      err,
      providerId,
      payoutAccountId,
    });
  });

  return adminIds;
}

async function notifyProviderVerificationApproved({
  providerId,
  restaurantId,
  queue = null,
}) {
  return enqueueNotification({
    userId: providerId,
    type: "provider_verification_approved",
    message: "Your provider account has been approved.",
    data: {
      restaurant_id: restaurantId,
      href: "/provider/listings",
    },
    queue,
  }).catch((err) => {
    logger.warn("Provider approval notification failed", {
      err,
      providerId,
      restaurantId,
    });
  });
}

async function notifyProviderVerificationRejected({
  providerId,
  restaurantId,
  queue = null,
}) {
  return enqueueNotification({
    userId: providerId,
    type: "provider_verification_rejected",
    message: "Your provider verification was rejected.",
    data: {
      restaurant_id: restaurantId,
      href: "/pending-verification",
    },
    queue,
  }).catch((err) => {
    logger.warn("Provider rejection notification failed", {
      err,
      providerId,
      restaurantId,
    });
  });
}

async function notifyProviderPayoutVerificationApproved({
  providerId,
  payoutAccountId,
  queue = null,
  publish = null,
}) {
  try {
    const job = await enqueueNotification({
      userId: providerId,
      type: "provider_payout_verification_approved",
      title: "Payout account verified",
      message:
        "Your payout account has been verified and is ready for settlement.",
      data: {
        action: "provider_payout_account_verified",
        payout_account_id: payoutAccountId,
        href: "/dashboard",
      },
      idempotencyKey: payoutAccountId
        ? `provider_payout_verification_approved:${payoutAccountId}`
        : null,
      queue,
    });
    await publishProviderFinancialUpdated({
      userIds: [providerId],
      action: "provider_payout_account_verified",
      providerId,
      payoutAccountId,
      publish,
    });
    return job;
  } catch (err) {
    logger.warn("Provider payout verification approval notification failed", {
      err,
      providerId,
      payoutAccountId,
    });
    return null;
  }
}

async function notifyProviderPayoutVerificationRejected({
  providerId,
  payoutAccountId,
  reason,
  queue = null,
  publish = null,
}) {
  const message = reason
    ? `Your payout account verification was rejected. Reason: ${reason}`
    : "Your payout account verification was rejected.";

  try {
    const job = await enqueueNotification({
      userId: providerId,
      type: "provider_payout_verification_rejected",
      title: "Payout account verification rejected",
      message,
      data: {
        action: "provider_payout_account_rejected",
        payout_account_id: payoutAccountId,
        reason: reason || null,
        href: "/dashboard",
      },
      idempotencyKey: payoutAccountId
        ? `provider_payout_verification_rejected:${payoutAccountId}`
        : null,
      queue,
    });
    await publishProviderFinancialUpdated({
      userIds: [providerId],
      action: "provider_payout_account_rejected",
      providerId,
      payoutAccountId,
      status: "rejected",
      publish,
    });
    return job;
  } catch (err) {
    logger.warn("Provider payout verification rejection notification failed", {
      err,
      providerId,
      payoutAccountId,
    });
    return null;
  }
}

async function notifyProviderPayoutChangeApproved({
  providerId,
  payoutAccountId,
  reason,
  queue = null,
  publish = null,
}) {
  try {
    const job = await enqueueNotification({
      userId: providerId,
      type: "provider_payout_change_approved",
      title: "Payout account change request approved",
      message: reason
        ? `Your payout account change request has been approved. ${reason}`
        : "Your payout account change request has been approved.",
      data: {
        action: "provider_payout_change_approved",
        payout_account_id: payoutAccountId,
        reason: reason || null,
        href: "/dashboard",
      },
      idempotencyKey: payoutAccountId
        ? `provider_payout_change_approved:${payoutAccountId}`
        : null,
      queue,
    });
    await publishProviderFinancialUpdated({
      userIds: [providerId],
      action: "provider_payout_change_approved",
      providerId,
      payoutAccountId,
      status: "replacement_pending",
      publish,
    });
    return job;
  } catch (err) {
    logger.warn("Provider payout change approval notification failed", {
      err,
      providerId,
      payoutAccountId,
    });
    return null;
  }
}

async function notifyProviderPayoutChangeRejected({
  providerId,
  payoutAccountId,
  reason,
  queue = null,
  publish = null,
}) {
  const message = reason
    ? `Your payout account change request was rejected. Reason: ${reason}`
    : "Your payout account change request was rejected.";

  try {
    const job = await enqueueNotification({
      userId: providerId,
      type: "provider_payout_change_rejected",
      title: "Payout account change request rejected",
      message,
      data: {
        action: "provider_payout_change_rejected",
        payout_account_id: payoutAccountId,
        reason: reason || null,
        href: "/dashboard",
      },
      idempotencyKey: payoutAccountId
        ? `provider_payout_change_rejected:${payoutAccountId}`
        : null,
      queue,
    });
    await publishProviderFinancialUpdated({
      userIds: [providerId],
      action: "provider_payout_change_rejected",
      providerId,
      payoutAccountId,
      status: "rejected",
      publish,
    });
    return job;
  } catch (err) {
    logger.warn("Provider payout change rejection notification failed", {
      err,
      providerId,
      payoutAccountId,
    });
    return null;
  }
}

async function notifyNgoVerificationApproved({
  ngoUserId,
  ngoId,
  queue = null,
}) {
  return enqueueNotification({
    userId: ngoUserId,
    type: "ngo_verification_approved",
    message: "Your NGO account has been approved.",
    data: {
      ngo_id: ngoId,
      href: "/ngo/nearby-listings",
    },
    queue,
  }).catch((err) => {
    logger.warn("NGO approval notification failed", { err, ngoUserId, ngoId });
  });
}

async function notifyNgoVerificationRejected({
  ngoUserId,
  ngoId,
  queue = null,
}) {
  return enqueueNotification({
    userId: ngoUserId,
    type: "ngo_verification_rejected",
    message: "Your NGO verification was rejected.",
    data: {
      ngo_id: ngoId,
      href: "/pending-verification",
    },
    queue,
  }).catch((err) => {
    logger.warn("NGO rejection notification failed", { err, ngoUserId, ngoId });
  });
}

async function notifyProviderReportSubmittedAgainstProvider({
  providerId,
  reportId,
  caseId,
  queue = null,
}) {
  return enqueueNotification({
    userId: providerId,
    type: "provider_report_submitted_against_provider",
    message: "A report has been submitted and is under review.",
    data: {
      report_id: reportId,
      case_id: caseId,
      href: caseId
        ? `/provider/moderation-cases/${caseId}`
        : "/provider/moderation-cases",
    },
    queue,
  }).catch((err) => {
    logger.warn("Provider report informational notification failed", {
      err,
      providerId,
      reportId,
      caseId,
    });
  });
}

async function notifyProviderSettlementProcessed({
  settlement,
  queue = null,
  publish = null,
}) {
  if (!settlement?.provider_id) return null;

  try {
    const job = await enqueueNotification({
      userId: settlement.provider_id,
      type: "provider_settlement_paid",
      title: "Settlement Processed",
      message: [
        `Your settlement of ${formatSettlementAmount(
          settlement.amount,
          settlement.currency,
        )} has been marked paid.`,
        "",
        "Reference:",
        settlement.payment_reference || "-",
      ].join("\n"),
      data: {
        action: "provider_settlement_paid",
        settlement_id: settlement.id,
        payment_reference: settlement.payment_reference || null,
        amount: settlement.amount,
        currency: settlement.currency || "INR",
        href: "/dashboard",
      },
      idempotencyKey: settlement.id
        ? `provider_settlement_paid:${settlement.id}`
        : null,
      queue,
    });
    await publishProviderFinancialUpdated({
      userIds: [settlement.provider_id],
      action: "provider_settlement_paid",
      providerId: settlement.provider_id,
      settlementId: settlement.id,
      status: "paid",
      publish,
    });
    return job;
  } catch (err) {
    logger.warn("Provider settlement paid notification failed", {
      err,
      settlementId: settlement.id,
      providerId: settlement.provider_id,
    });
    return null;
  }
}

async function notifyProviderSettlementFailed({
  settlement,
  queue = null,
  publish = null,
}) {
  if (!settlement?.provider_id) return null;

  const reason =
    trimSettlementReason(settlement.notes) || "No reason provided.";

  try {
    const job = await enqueueNotification({
      userId: settlement.provider_id,
      type: "provider_settlement_failed",
      title: "Settlement Failed",
      message: ["Settlement processing failed.", "", "Reason:", reason].join(
        "\n",
      ),
      data: {
        action: "provider_settlement_failed",
        settlement_id: settlement.id,
        payment_reference: settlement.payment_reference || null,
        amount: settlement.amount,
        currency: settlement.currency || "INR",
        reason,
        href: "/dashboard",
      },
      idempotencyKey: settlement.id
        ? `provider_settlement_failed:${settlement.id}`
        : null,
      queue,
    });
    await publishProviderFinancialUpdated({
      userIds: [settlement.provider_id],
      action: "provider_settlement_failed",
      providerId: settlement.provider_id,
      settlementId: settlement.id,
      status: "failed",
      publish,
    });
    return job;
  } catch (err) {
    logger.warn("Provider settlement failed notification failed", {
      err,
      settlementId: settlement.id,
      providerId: settlement.provider_id,
    });
    return null;
  }
}

function trimSettlementReason(value) {
  const reason = String(value || "").trim();
  return reason ? reason.slice(0, 500) : "";
}

module.exports = {
  enqueueNotification,
  getAdminUserIds,
  notifyAdminsModerationCaseEscalated,
  notifyAdminsNgoVerificationSubmitted,
  notifyAdminsProviderPayoutAccountSubmitted,
  notifyAdminsProviderPayoutChangeRequested,
  notifyAdminsProviderReportSubmitted,
  notifyAdminsProviderVerificationSubmitted,
  notifyNgoVerificationApproved,
  notifyNgoVerificationRejected,
  notifyProviderReportSubmittedAgainstProvider,
  notifyProviderSettlementFailed,
  notifyProviderSettlementProcessed,
  notifyProviderVerificationApproved,
  notifyProviderVerificationRejected,
  notifyProviderPayoutVerificationApproved,
  notifyProviderPayoutVerificationRejected,
  notifyProviderPayoutChangeApproved,
  notifyProviderPayoutChangeRejected,
  publishProviderFinancialUpdated,
};
