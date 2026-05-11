const express = require("express");
const router = express.Router();

const { cashfreeWebhook } = require("../controllers/payment.controller");

router.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  cashfreeWebhook,
);

module.exports = router;
