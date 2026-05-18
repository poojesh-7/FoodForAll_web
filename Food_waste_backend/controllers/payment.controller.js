const logger = require("../shared/utils/logger");
const { captureError } = require("../shared/services/errorTracking.service");
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

    logger.payment("Cashfree webhook rejected", {
      err,
      statusCode,
    });
    void captureError(err, {
      category: "payment",
      eventName: "cashfree_webhook_rejected",
      severity: statusCode >= 500 ? "error" : "warning",
      statusCode,
      alert: statusCode >= 500,
      alertKey: "payment:webhook_rejected",
    });

    if (statusCode >= 500) {
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    return res.status(statusCode).json({ error: err.message || "Webhook rejected" });
  }
};
