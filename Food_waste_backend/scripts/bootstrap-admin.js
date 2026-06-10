const { loadEnv } = require("./load-env");

loadEnv();

const pool = require("../shared/config/db");
const { validateEnvironment } = require("../shared/config/env");
const {
  getPhoneLookupValues,
  normalizePhoneNumber,
} = require("../utils/phone");
const {
  recordOperationalEvent,
} = require("../shared/services/observability.service");

const CONFIRMATION = "promote-admin";

function requireConfirmation() {
  if (process.env.BOOTSTRAP_ADMIN_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set BOOTSTRAP_ADMIN_CONFIRM=${CONFIRMATION} to promote the first admin`
    );
  }
}

function getBootstrapSelector() {
  const userId = String(process.env.BOOTSTRAP_ADMIN_USER_ID || "").trim();
  const rawPhone = String(process.env.BOOTSTRAP_ADMIN_PHONE || "").trim();

  if (userId && rawPhone) {
    throw new Error("Use either BOOTSTRAP_ADMIN_USER_ID or BOOTSTRAP_ADMIN_PHONE, not both");
  }

  if (userId) {
    return {
      params: [userId],
      sql: "id=$1",
      type: "user_id",
      value: userId,
    };
  }

  const phone = normalizePhoneNumber(rawPhone);
  if (!phone) {
    throw new Error("BOOTSTRAP_ADMIN_PHONE must be a valid phone number");
  }

  return {
    params: [getPhoneLookupValues(phone)],
    sql: "phone = ANY($1::text[])",
    type: "phone",
    value: phone,
  };
}

async function promoteFirstAdmin(client, selector) {
  const targetResult = await client.query(
    `
    SELECT id, phone, role
    FROM users
    WHERE ${selector.sql}
    ORDER BY created_at ASC
    LIMIT 1
    `,
    selector.params
  );
  const target = targetResult.rows[0];

  if (!target) {
    throw new Error("Bootstrap admin target user was not found");
  }

  const adminCountResult = await client.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role='admin'"
  );
  const adminCount = Number(adminCountResult.rows[0]?.count || 0);

  if (adminCount > 0 && target.role !== "admin") {
    throw new Error(
      "At least one admin already exists; use normal admin governance to add more admins"
    );
  }

  const updateResult = await client.query(
    `
    UPDATE users
    SET role='admin',
        is_verified=true,
        auth_session_version=COALESCE(auth_session_version, 0) + 1,
        last_auth_activity_at=NOW()
    WHERE id=$1
    RETURNING id, role
    `,
    [target.id]
  );

  return {
    alreadyAdmin: target.role === "admin",
    user: updateResult.rows[0],
  };
}

async function main() {
  validateEnvironment();
  requireConfirmation();
  const selector = getBootstrapSelector();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await promoteFirstAdmin(client, selector);
    await client.query("COMMIT");
    await recordOperationalEvent({
      category: "security",
      severity: "warning",
      eventName: "bootstrap_admin_promoted",
      metadata: {
        selectorType: selector.type,
        userId: result.user.id,
        alreadyAdmin: result.alreadyAdmin,
      },
    });
    process.stdout.write(`Admin bootstrap complete for user ${result.user.id}\n`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
