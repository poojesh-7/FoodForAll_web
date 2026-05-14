const twilio = require("twilio");

let client;

function getClient() {
  if (!client) {
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  return client;
}

function getVerifyService() {
  return getClient().verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID);
}

async function sendVerification(to) {
  return getVerifyService().verifications.create({
    to,
    channel: "sms",
  });
}

async function checkVerification(to, code) {
  return getVerifyService().verificationChecks.create({
    to,
    code,
  });
}

function getSafeTwilioError(err, fallbackMessage) {
  const code = String(err?.code || "");
  const statusCode = err?.status || err?.statusCode;

  if (statusCode === 429 || code === "20429" || code === "60203") {
    return {
      status: 429,
      message: "Too many OTP requests. Please try again later.",
    };
  }

  if (code === "60202") {
    return {
      status: 429,
      message: "Too many verification attempts. Please request a new OTP.",
    };
  }

  if (code === "60200" || statusCode === 400) {
    return {
      status: 400,
      message: "Valid phone number required",
    };
  }

  return {
    status: 502,
    message: fallbackMessage,
  };
}

module.exports = {
  checkVerification,
  getSafeTwilioError,
  sendVerification,
};
