const pool = require("../config/db");

const ACTIVE_ACCOUNT_ROLES = new Set(["user", "volunteer", "ngo", "provider", "admin"]);

function withStatus(message, statusCode, reason) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.reason = reason;
  return error;
}

function isActiveUntil(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

async function getLatestEntity(client, table, userId) {
  const result = await client.query(
    `
    SELECT id, is_verified, rejection_reason
    FROM ${table}
    WHERE user_id=$1
    ORDER BY is_verified DESC, id DESC
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function getAuthorizationContext({ client = pool, userId }) {
  const userResult = await client.query(
    `
    SELECT id, role, is_verified, banned_until, cooldown_until,
           requires_reliability_deposit, restriction_level, restriction_reason
    FROM users
    WHERE id=$1
    `,
    [userId]
  );

  const user = userResult.rows[0];
  if (!user) {
    throw withStatus("User not found", 401, "user_not_found");
  }

  const context = {
    id: user.id,
    role: user.role,
    user,
    provider: null,
    ngo: null,
  };

  if (user.role === "provider") {
    context.provider = await getLatestEntity(client, "restaurants", userId);
  }

  if (user.role === "ngo") {
    context.ngo = await getLatestEntity(client, "ngos", userId);
  }

  return context;
}

function assertActiveAccount(context) {
  if (!ACTIVE_ACCOUNT_ROLES.has(context.role)) {
    throw withStatus("Invalid user role", 403, "invalid_role");
  }

  if (isActiveUntil(context.user.banned_until)) {
    throw withStatus("Account is banned", 403, "account_banned");
  }

  return context;
}

function assertVerifiedBaseAccount(context) {
  return assertActiveAccount(context);
}

function assertRole(context, role) {
  assertActiveAccount(context);

  if (context.role !== role) {
    throw withStatus(`${role} access required`, 403, `missing_${role}_role`);
  }

  return context;
}

function assertVerifiedProviderContext(context) {
  assertRole(context, "provider");

  if (!context.provider || context.provider.is_verified !== true) {
    throw withStatus("Provider is not verified", 403, "provider_not_verified");
  }

  return context;
}

function assertVerifiedNGOContext(context) {
  assertRole(context, "ngo");

  if (!context.ngo || context.ngo.is_verified !== true) {
    throw withStatus("NGO is not approved", 403, "ngo_not_approved");
  }

  return context;
}

function assertVerifiedVolunteerContext(context) {
  return assertRole(context, "volunteer");
}

function assertVerifiedUserContext(context) {
  return assertRole(context, "user");
}

const assertVolunteerContext = assertVerifiedVolunteerContext;
const assertUserContext = assertVerifiedUserContext;

function assertAdminContext(context) {
  assertRole(context, "admin");

  if (context.user.is_verified !== true) {
    throw withStatus("Admin access required", 403, "admin_not_verified");
  }

  return context;
}

async function assertVerifiedProvider({ client = pool, userId }) {
  return assertVerifiedProviderContext(
    await getAuthorizationContext({ client, userId })
  );
}

async function assertVerifiedNGO({ client = pool, userId }) {
  return assertVerifiedNGOContext(
    await getAuthorizationContext({ client, userId })
  );
}

async function assertVerifiedVolunteer({ client = pool, userId }) {
  return assertVerifiedVolunteerContext(
    await getAuthorizationContext({ client, userId })
  );
}

async function assertVerifiedUser({ client = pool, userId }) {
  return assertVerifiedUserContext(
    await getAuthorizationContext({ client, userId })
  );
}

const assertVolunteer = assertVerifiedVolunteer;
const assertUser = assertVerifiedUser;

async function assertAdmin({ client = pool, userId }) {
  return assertAdminContext(await getAuthorizationContext({ client, userId }));
}

async function assertActiveUserAccount({ client = pool, userId }) {
  return assertActiveAccount(await getAuthorizationContext({ client, userId }));
}

function assertPaymentAuthorization({ user, reservations }) {
  if (!user?.id || !["user", "ngo"].includes(user.role)) {
    throw withStatus("Payment authorization failed", 403, "invalid_payment_role");
  }

  for (const reservation of reservations || []) {
    if (String(reservation.user_id) !== String(user.id)) {
      throw withStatus(
        "Payment reservation ownership mismatch",
        403,
        "payment_owner_mismatch"
      );
    }

    if (user.role === "user" && reservation.pickup_type !== "self_pickup") {
      throw withStatus("Invalid user payment flow", 403, "invalid_user_payment");
    }

    if (user.role === "ngo" && reservation.pickup_type !== "ngo") {
      throw withStatus("Invalid NGO payment flow", 403, "invalid_ngo_payment");
    }
  }
}

module.exports = {
  assertActiveAccount,
  assertActiveUserAccount,
  assertAdmin,
  assertAdminContext,
  assertPaymentAuthorization,
  assertRole,
  assertUser,
  assertUserContext,
  assertVerifiedBaseAccount,
  assertVerifiedNGO,
  assertVerifiedNGOContext,
  assertVerifiedProvider,
  assertVerifiedProviderContext,
  assertVerifiedUser,
  assertVerifiedUserContext,
  assertVerifiedVolunteer,
  assertVerifiedVolunteerContext,
  assertVolunteer,
  assertVolunteerContext,
  getAuthorizationContext,
  isActiveUntil,
};
