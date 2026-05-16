const restrictionService = require("./restriction.service");

async function applyPenalty(options) {
  return restrictionService.recordViolation(options);
}

async function applyRecovery(options) {
  return restrictionService.recordSuccessfulPickup(options);
}

module.exports = {
  applyPenalty,
  applyRecovery,
};
