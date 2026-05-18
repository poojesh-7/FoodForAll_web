const logger = require("../shared/utils/logger");
const {
  handleCashfreeWebhook,
} = require("../shared/services/paymentReconciliation.service");

exports.cashfreeWebhook = async (req, res) => {
  try {
    await handleCashfreeWebhook({
      headers: req.headers,
      rawBody: req.body,
    });

    return res.sendStatus(200);
  } catch (err) {
    const statusCode = err.statusCode || 500;

    logger.warn("Cashfree webhook rejected", {
      err,
      statusCode,
    });

    if (statusCode >= 500) {
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    return res.status(statusCode).json({ error: err.message || "Webhook rejected" });
  }
};
