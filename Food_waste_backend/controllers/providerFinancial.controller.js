const logger = require("../shared/utils/logger");
const {
  deactivateProviderPayoutAccount,
  getProviderSettlementSummary,
  listProviderPayoutAccounts,
  replaceProviderPayoutAccount,
  requestProviderPayoutAccountChange,
} = require("../shared/services/providerPayout.service");
const {
  recordOperationalEvent,
} = require("../shared/services/observability.service");
const {
  notifyAdminsProviderPayoutAccountSubmitted,
  notifyAdminsProviderPayoutChangeRequested,
} = require("../shared/services/operationalNotification.service");

exports.getMyPayoutAccounts = async (req, res) => {
  try {
    const payoutAccounts = await listProviderPayoutAccounts({
      providerId: req.user.id,
    });
    res.json(payoutAccounts);
  } catch (err) {
    logger.error("Failed to fetch provider payout accounts", {
      err,
      providerId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch payout accounts",
    });
  }
};

exports.replaceMyPayoutAccount = async (req, res) => {
  try {
    const existing = await listProviderPayoutAccounts({
      providerId: req.user.id,
    });
    const previousAccount = existing.active_account;

    const account = await replaceProviderPayoutAccount({
      providerId: req.user.id,
      payload: req.body,
    });
    const previousChangeStatus = String(
      previousAccount?.change_request_status || "",
    ).toLowerCase();
    const isReplacementUpload = Boolean(
      previousAccount &&
        (previousAccount.verification_status === "verified" ||
          previousAccount.is_verified) &&
        ["approved", "replacement_pending"].includes(previousChangeStatus),
    );

    void recordOperationalEvent({
      category: "financial",
      severity: "info",
      eventName: "payout_account_updated",
      metadata: {
        providerId: req.user.id,
        payoutAccountId: account.id,
        previousVerificationStatus:
          previousAccount?.verification_status ?? null,
        newVerificationStatus: account.verification_status ?? null,
      },
    });
    void notifyAdminsProviderPayoutAccountSubmitted({
      providerId: req.user.id,
      payoutAccountId: account.id,
      previousPayoutAccountId: previousAccount?.id || null,
      isReplacement: isReplacementUpload,
    });

    res.status(201).json({
      message: "Payout account saved",
      account,
    });
  } catch (err) {
    logger.error("Failed to save provider payout account", {
      err,
      providerId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to save payout account",
    });
  }
};

exports.deactivateMyPayoutAccount = async (req, res) => {
  try {
    const account = await deactivateProviderPayoutAccount({
      providerId: req.user.id,
    });
    res.json({
      message: account
        ? "Payout account deactivated"
        : "No active payout account found",
      account,
    });
  } catch (err) {
    logger.error("Failed to deactivate provider payout account", {
      err,
      providerId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to deactivate payout account",
    });
  }
};

exports.requestPayoutAccountChange = async (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  if (!reason) {
    return res.status(400).json({ error: "Change request reason is required" });
  }

  try {
    const account = await requestProviderPayoutAccountChange({
      providerId: req.user.id,
      reason,
    });
    void notifyAdminsProviderPayoutChangeRequested({
      providerId: req.user.id,
      payoutAccountId: account.id,
      reason: account.change_request_reason || reason,
    });

    res.status(201).json({
      message: "Payout account change request submitted",
      account,
    });
  } catch (err) {
    logger.error("Failed to submit provider payout account change request", {
      err,
      providerId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to submit payout account change request",
    });
  }
};

exports.getMySettlementSummary = async (req, res) => {
  try {
    const summary = await getProviderSettlementSummary({
      providerId: req.user.id,
      limit: req.query.limit,
    });
    res.json({ summary });
  } catch (err) {
    logger.error("Failed to fetch provider settlement summary", {
      err,
      providerId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch settlement summary",
    });
  }
};
