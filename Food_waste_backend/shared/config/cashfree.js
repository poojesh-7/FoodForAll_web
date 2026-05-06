const { Cashfree, CFEnvironment } = require("cashfree-pg");

const cashfree = new Cashfree({
  clientId: process.env.CASHFREE_APP_ID,
  clientSecret: process.env.CASHFREE_SECRET_KEY,
  environment: CFEnvironment.SANDBOX,
});

module.exports = cashfree;