function normalizeEmail(value) {
  if (value === undefined || value === null) return null;

  const email = String(value).trim().toLowerCase();
  return email || null;
}

function isUniqueViolation(error) {
  return error?.code === "23505";
}

function isIdentityUniqueViolation(error) {
  if (!isUniqueViolation(error)) return false;

  const constraint = String(error.constraint || "");
  return (
    constraint.includes("users_google") ||
    constraint.includes("users_email") ||
    constraint.includes("users_phone") ||
    constraint.includes("google") ||
    constraint.includes("email") ||
    constraint.includes("phone")
  );
}

function getIdentityConflictMessage(error) {
  const constraint = String(error?.constraint || "");
  const detail = String(error?.detail || "").toLowerCase();

  if (constraint.includes("phone") || detail.includes("(phone)")) {
    return "Phone number already registered";
  }

  if (constraint.includes("google") || detail.includes("(google_id)")) {
    return "Google account already linked";
  }

  return "Email already registered";
}

async function findUserByEmail(pool, normalizedEmail) {
  if (!normalizedEmail) return null;

  const result = await pool.query(
    `
    SELECT id
    FROM users
    WHERE email IS NOT NULL
      AND lower(trim(email))=$1
    LIMIT 1
    `,
    [normalizedEmail]
  );

  return result.rows[0] || null;
}

async function ensureEmailAvailable(pool, normalizedEmail, excludedUserId = null) {
  const existingUser = await findUserByEmail(pool, normalizedEmail);

  if (
    existingUser &&
    (!excludedUserId || String(existingUser.id) !== String(excludedUserId))
  ) {
    const error = new Error("Email already registered");
    error.statusCode = 409;
    throw error;
  }
}

async function findUserByGoogleId(pool, googleId) {
  if (!googleId) return null;

  const result = await pool.query(
    `
    SELECT id
    FROM users
    WHERE google_id=$1
    LIMIT 1
    `,
    [googleId]
  );

  return result.rows[0] || null;
}

async function findUserByPhone(pool, normalizedPhone, lookupValues = []) {
  if (!normalizedPhone) return null;

  const values = lookupValues.length ? lookupValues : [normalizedPhone];
  const result = await pool.query(
    `
    SELECT id, phone
    FROM users
    WHERE phone = ANY($1::text[])
    ORDER BY CASE WHEN phone=$2 THEN 0 ELSE 1 END
    LIMIT 1
    `,
    [values, normalizedPhone]
  );

  return result.rows[0] || null;
}

async function ensurePhoneAvailable(
  pool,
  normalizedPhone,
  excludedUserId = null,
  lookupValues = []
) {
  const existingUser = await findUserByPhone(pool, normalizedPhone, lookupValues);

  if (
    existingUser &&
    (!excludedUserId || String(existingUser.id) !== String(excludedUserId))
  ) {
    const error = new Error("Phone number already registered");
    error.statusCode = 409;
    throw error;
  }
}

module.exports = {
  ensureEmailAvailable,
  ensurePhoneAvailable,
  findUserByEmail,
  findUserByGoogleId,
  findUserByPhone,
  getIdentityConflictMessage,
  isIdentityUniqueViolation,
  normalizeEmail,
};
