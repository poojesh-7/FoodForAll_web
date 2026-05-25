const express = require("express");
const {
  getMetricsSnapshot,
  getPrometheusMetrics,
} = require("../shared/services/metrics.service");
const { isProductionLike } = require("../shared/config/env");
const logger = require("../shared/utils/logger");

function hasMetricsAccess(req) {
  if (!isProductionLike(process.env.APP_ENV)) return true;
  const configuredToken = process.env.METRICS_TOKEN;
  if (!configuredToken) return false;

  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const headerToken = req.headers["x-metrics-token"];
  const token = bearer || (Array.isArray(headerToken) ? headerToken[0] : headerToken);
  return token === configuredToken;
}

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

router.get("/metrics", (req, res) => {
  if (!hasMetricsAccess(req)) {
    logger.security("Health metrics access denied", {
      ip: req.ip,
      path: req.originalUrl,
    });
    return res.status(404).send("Not found");
  }

  res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
  return res.send(getPrometheusMetrics());
});

router.get("/metrics/summary", (req, res) => {
  if (!hasMetricsAccess(req)) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json({ metrics: getMetricsSnapshot() });
});

module.exports = router;
