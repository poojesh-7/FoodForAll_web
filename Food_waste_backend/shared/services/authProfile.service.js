const { normalizePhoneNumber } = require("../../utils/phone");

function withStatus(message, statusCode, reason) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.reason = reason;
  return error;
}

function assertProfilePhoneMatchesAuthenticatedUser({
  submittedPhone,
  authenticatedPhone,
} = {}) {
  const normalizedSubmittedPhone = normalizePhoneNumber(submittedPhone);
  const normalizedAuthenticatedPhone = normalizePhoneNumber(authenticatedPhone);

  if (!normalizedSubmittedPhone) {
    throw withStatus("Valid phone required", 400, "invalid_profile_phone");
  }

  if (
    !normalizedAuthenticatedPhone ||
    normalizedAuthenticatedPhone !== normalizedSubmittedPhone
  ) {
    throw withStatus(
      "Profile phone does not match authenticated user",
      403,
      "profile_phone_mismatch"
    );
  }

  return normalizedSubmittedPhone;
}

module.exports = {
  assertProfilePhoneMatchesAuthenticatedUser,
};
