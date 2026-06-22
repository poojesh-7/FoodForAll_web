const pool = require("../config/db");
const logger = require("../utils/logger");

function getNotificationQueue() {
  return require("../../queues/notification.queue");
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
    `
  );

  return result.rows.map((row) => row.id);
}

async function notifyAdmins({
  type,
  message,
  data = {},
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
        message,
        data,
        queue,
      }).catch((err) => {
        logger.warn("Admin operational notification enqueue failed", {
          err,
          adminId,
          type,
          ...logContext,
        });
      })
    )
  );

  return adminIds;
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
      href: caseId ? `/admin/moderation-cases/${caseId}` : "/admin/provider-reports",
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

async function notifyNgoVerificationApproved({ ngoUserId, ngoId, queue = null }) {
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

async function notifyNgoVerificationRejected({ ngoUserId, ngoId, queue = null }) {
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
      href: caseId ? `/provider/moderation-cases/${caseId}` : "/provider/moderation-cases",
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
}) {
  if (!settlement?.provider_id) return null;

  return enqueueNotification({
    userId: settlement.provider_id,
    type: "provider_settlement_paid",
    title: "Settlement Processed",
    message: [
      `Your settlement of ${formatSettlementAmount(
        settlement.amount,
        settlement.currency
      )} has been marked paid.`,
      "",
      "Reference:",
      settlement.payment_reference || "-",
    ].join("\n"),
    data: {
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
  }).catch((err) => {
    logger.warn("Provider settlement paid notification failed", {
      err,
      settlementId: settlement.id,
      providerId: settlement.provider_id,
    });
  });
}

async function notifyProviderSettlementFailed({
  settlement,
  queue = null,
}) {
  if (!settlement?.provider_id) return null;

  const reason = trimSettlementReason(settlement.notes) || "No reason provided.";

  return enqueueNotification({
    userId: settlement.provider_id,
    type: "provider_settlement_failed",
    title: "Settlement Failed",
    message: [
      "Settlement processing failed.",
      "",
      "Reason:",
      reason,
    ].join("\n"),
    data: {
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
  }).catch((err) => {
    logger.warn("Provider settlement failed notification failed", {
      err,
      settlementId: settlement.id,
      providerId: settlement.provider_id,
    });
  });
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
  notifyAdminsProviderReportSubmitted,
  notifyAdminsProviderVerificationSubmitted,
  notifyNgoVerificationApproved,
  notifyNgoVerificationRejected,
  notifyProviderReportSubmittedAgainstProvider,
  notifyProviderSettlementFailed,
  notifyProviderSettlementProcessed,
  notifyProviderVerificationApproved,
  notifyProviderVerificationRejected,
};
