const logger = require("../shared/utils/logger");
const {
  deactivateProviderPayoutAccount,
  getProviderSettlementSummary,
  listProviderPayoutAccounts,
  replaceProviderPayoutAccount,
} = require("../shared/services/providerPayout.service");

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
    const account = await replaceProviderPayoutAccount({
      providerId: req.user.id,
      payload: req.body,
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
