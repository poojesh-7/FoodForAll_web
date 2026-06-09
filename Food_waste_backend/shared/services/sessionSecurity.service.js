const pool = require("../config/db");

class SessionSecurityError extends Error {
  constructor(reason, message, statusCode = 401) {
    super(message);
    this.name = "SessionSecurityError";
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

function toSessionVersion(value) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function getTokenSessionVersion(decoded) {
  return toSessionVersion(decoded?.sv ?? decoded?.sessionVersion ?? decoded?.session_version);
}

async function assertAccessTokenSession({ client = pool, decoded } = {}) {
  const userId = decoded?.id;
  if (!userId) {
    throw new SessionSecurityError("invalid_user_id", "Authentication token is invalid");
  }

  const result = await client.query(
    `
    SELECT id, role, auth_session_version
    FROM users
    WHERE id=$1
    `,
    [userId]
  );

  const user = result.rows[0];
  if (!user) {
    throw new SessionSecurityError("user_not_found", "User not found");
  }

  const tokenVersion = getTokenSessionVersion(decoded);
  const currentVersion = toSessionVersion(user.auth_session_version);

  if (tokenVersion !== currentVersion) {
    throw new SessionSecurityError(
      "access_token_revoked",
      "Authentication token has been revoked"
    );
  }

  return {
    id: user.id,
    role: user.role,
    auth_session_version: currentVersion,
  };
}

module.exports = {
  SessionSecurityError,
  assertAccessTokenSession,
  getTokenSessionVersion,
  toSessionVersion,
};
