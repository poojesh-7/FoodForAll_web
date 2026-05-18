const { Cashfree, CFEnvironment } = require("cashfree-pg");

const configuredEnvironment = String(process.env.CASHFREE_ENV || "").toLowerCase();
const environment =
  configuredEnvironment === "production" || configuredEnvironment === "prod"
    ? CFEnvironment.PRODUCTION
    : CFEnvironment.SANDBOX;

const cashfree = new Cashfree(
  environment,
  process.env.CASHFREE_APP_ID,
  process.env.CASHFREE_SECRET_KEY,
  undefined,
  undefined,
  undefined,
  false
);

module.exports = cashfree;
