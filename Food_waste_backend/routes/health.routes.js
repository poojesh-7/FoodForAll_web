const express = require("express");
const {
  getHealth,
  getPaymentHealthCheck,
  getQueueHealthCheck,
} = require("../shared/services/health.service");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const health = await getHealth({ io: req.app.get("io") });
    res.status(health.status === "healthy" ? 200 : 503).json(health);
  } catch (err) {
    next(err);
  }
});

router.get("/queues", async (req, res, next) => {
  try {
    const health = await getQueueHealthCheck();
    res.status(health.status === "healthy" ? 200 : 503).json(health);
  } catch (err) {
    next(err);
  }
});

router.get("/payments", async (req, res, next) => {
  try {
    const health = await getPaymentHealthCheck();
    res.status(health.status === "healthy" ? 200 : 503).json(health);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
