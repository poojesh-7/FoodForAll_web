const express = require("express");
const router = express.Router();

const { cashfreeWebhook } = require("../controllers/payment.controller");

router.post("/webhook", cashfreeWebhook);

module.exports = router;