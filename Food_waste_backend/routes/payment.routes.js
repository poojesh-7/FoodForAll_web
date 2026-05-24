const express = require("express");
const router = express.Router();

const { cashfreeWebhook } = require("../controllers/payment.controller");
const { paymentWebhookLimiter } = require("../middlewares/rateLimit.middleware");

router.post(
  "/webhook",
  paymentWebhookLimiter,
  express.raw({ type: "application/json", limit: "1mb" }),
  cashfreeWebhook,
);

module.exports = router;
