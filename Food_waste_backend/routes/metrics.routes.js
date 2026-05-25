const express = require("express");
const {
  getPrometheusMetrics,
} = require("../shared/services/metrics.service");
const { isProductionLike } = require("../shared/config/env");
const logger = require("../shared/utils/logger");

const router = express.Router();

function isAuthorized(req) {
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

router.get("/", (req, res) => {
  if (!isAuthorized(req)) {
    logger.security("Metrics endpoint access denied", {
      ip: req.ip,
      path: req.originalUrl,
    });
    return res.status(404).send("Not found");
  }

  res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
  return res.send(getPrometheusMetrics());
});

module.exports = router;
