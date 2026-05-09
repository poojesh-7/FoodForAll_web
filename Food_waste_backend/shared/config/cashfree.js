const { Cashfree, CFEnvironment } = require("cashfree-pg");

const environment =
  process.env.NODE_ENV === "production"
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
