const logger = require("../shared/utils/logger");
const {
  assertActiveUserAccount,
  assertUser,
  assertVerifiedNGO,
  assertVerifiedProvider,
  assertVolunteer,
} = require("../shared/services/authorization.service");

function deny(req, res, err, gate) {
  const statusCode = err.statusCode || 403;

  logger.security("Privileged authorization failed", {
    gate,
    reason: err.reason || "authorization_failed",
    userId: req.user?.id,
    role: req.user?.role,
    path: req.originalUrl,
    ip: req.ip,
  });

  return res.status(statusCode).json({
    error: err.message || "Access denied",
  });
}

function createGate(gate, check) {
  return async (req, res, next) => {
    try {
      const context = await check({
        userId: req.user.id,
      });

      req.authorization = context;
      req.user.role = context.role;
      next();
    } catch (err) {
      return deny(req, res, err, gate);
    }
  };
}

const requireActiveAccount = createGate(
  "active_account",
  assertActiveUserAccount
);

const requireUser = createGate("user", assertUser);

const requireVolunteer = createGate("volunteer", assertVolunteer);

const requireVerifiedNGO = createGate("verified_ngo", assertVerifiedNGO);

const requireVerifiedProvider = createGate(
  "verified_provider",
  assertVerifiedProvider
);

const requireVerified = createGate("verified_role", async ({ userId }) => {
  const context = await assertActiveUserAccount({ userId });

  if (context.role === "provider") {
    return assertVerifiedProvider({ userId });
  }

  if (context.role === "ngo") {
    return assertVerifiedNGO({ userId });
  }

  if (context.role === "volunteer") {
    return assertVolunteer({ userId });
  }

  return assertUser({ userId });
});

module.exports = {
  requireActiveAccount,
  requireUser,
  requireVerified,
  requireVerifiedNGO,
  requireVerifiedProvider,
  requireVerifiedUser: requireUser,
  requireVerifiedVolunteer: requireVolunteer,
  requireVolunteer,
};
