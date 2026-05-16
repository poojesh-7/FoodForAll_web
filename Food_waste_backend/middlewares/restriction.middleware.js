const { getReservationPolicy } = require("../shared/services/restriction.service");

function policyError(policy, noun) {
  if (policy.bannedUntil) {
    return `${noun} unavailable until ${policy.bannedUntil.toISOString()}`;
  }
  if (policy.cooldownUntil) {
    return `${noun} cooldown active until ${policy.cooldownUntil.toISOString()}`;
  }
  return policy.restrictionReason || `${noun} unavailable`;
}

async function attachPolicy(req, res, next, noun, allowed) {
  try {
    const policy = await getReservationPolicy({
      userId: req.user.id,
      role: req.user.role,
    });
    req.policy = policy;

    if (!allowed(policy)) {
      return res.status(403).json({
        error: policyError(policy, noun),
        policy,
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

function reservationRestrictionMiddleware(req, res, next) {
  return attachPolicy(req, res, next, "Reservation", (policy) => policy.canReserve);
}

function volunteerRestrictionMiddleware(req, res, next) {
  return attachPolicy(req, res, next, "Volunteer task", (policy) => policy.canTakeTask);
}

function providerRestrictionMiddleware(req, res, next) {
  return attachPolicy(req, res, next, "Listing", (policy) => policy.canList);
}

module.exports = {
  reservationRestrictionMiddleware,
  volunteerRestrictionMiddleware,
  providerRestrictionMiddleware,
};
