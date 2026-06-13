const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");
const logger = require("../utils/logger");
const { normalizePhoneNumber } = require("../../utils/phone");

function formatDuplicateGroups(groups) {
  return groups
    .map((group) => `${group.identity}: ${group.ids.join(", ")}`)
    .join("; ");
}

async function getDuplicateEmails(client) {
  const result = await client.query(`
    SELECT lower(trim(email)) AS identity, array_agg(id ORDER BY id) AS ids
    FROM users
    WHERE email IS NOT NULL
      AND trim(email) <> ''
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  `);

  return result.rows;
}

async function getDuplicatePhones(client) {
  const result = await client.query(`
    SELECT trim(phone) AS identity, array_agg(id ORDER BY id) AS ids
    FROM users
    WHERE phone IS NOT NULL
      AND trim(phone) <> ''
    GROUP BY trim(phone)
    HAVING count(*) > 1
  `);

  return result.rows;
}

async function getDuplicateGoogleIds(client) {
  const column = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name='users'
        AND column_name='google_id'
    ) AS exists
  `);

  if (!column.rows[0]?.exists) return [];

  const result = await client.query(`
    SELECT trim(google_id) AS identity, array_agg(id ORDER BY id) AS ids
    FROM users
    WHERE google_id IS NOT NULL
      AND trim(google_id) <> ''
    GROUP BY trim(google_id)
    HAVING count(*) > 1
  `);

  return result.rows;
}

async function normalizeExistingEmails(client) {
  await client.query(`
    UPDATE users
    SET email=lower(trim(email))
    WHERE email IS NOT NULL
      AND email <> lower(trim(email))
  `);
}

async function normalizeExistingPhones(client) {
  const result = await client.query(`
    SELECT id, phone
    FROM users
    WHERE phone IS NOT NULL
      AND trim(phone) <> ''
  `);

  const normalizedByUser = result.rows
    .map((row) => ({
      id: row.id,
      phone: row.phone,
      normalizedPhone: normalizePhoneNumber(row.phone),
    }))
    .filter((row) => row.normalizedPhone);

  const idsByPhone = new Map();

  for (const row of normalizedByUser) {
    const ids = idsByPhone.get(row.normalizedPhone) || [];
    ids.push(row.id);
    idsByPhone.set(row.normalizedPhone, ids);
  }

  const duplicateGroups = Array.from(idsByPhone.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([identity, ids]) => ({ identity, ids }));

  if (duplicateGroups.length) {
    throw new Error(
      `Duplicate phone numbers after normalization: ${formatDuplicateGroups(
        duplicateGroups
      )}`
    );
  }

  for (const row of normalizedByUser) {
    if (row.phone !== row.normalizedPhone) {
      await client.query("UPDATE users SET phone=$1 WHERE id=$2", [
        row.normalizedPhone,
        row.id,
      ]);
    }
  }
}

async function assertNoIdentityDuplicates(client) {
  const duplicateEmails = await getDuplicateEmails(client);
  const duplicatePhones = await getDuplicatePhones(client);
  const duplicateGoogleIds = await getDuplicateGoogleIds(client);

  if (duplicateEmails.length) {
    throw new Error(
      `Duplicate emails exist: ${formatDuplicateGroups(duplicateEmails)}`
    );
  }

  if (duplicatePhones.length) {
    throw new Error(
      `Duplicate phone numbers exist: ${formatDuplicateGroups(duplicatePhones)}`
    );
  }

  if (duplicateGoogleIds.length) {
    throw new Error(
      `Duplicate Google identities exist: ${formatDuplicateGroups(duplicateGoogleIds)}`
    );
  }
}

async function createIdentityIndexes(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS google_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'otp',
      ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP NULL
  `);

  await client.query(`
    UPDATE users
    SET email_verified=false
    WHERE email_verified IS NULL
  `);

  await client.query(`
    UPDATE users
    SET auth_provider='otp'
    WHERE auth_provider IS NULL OR trim(auth_provider) = ''
  `);

  await client.query(`
    ALTER TABLE users
      ALTER COLUMN phone DROP NOT NULL,
      ALTER COLUMN email_verified SET DEFAULT false,
      ALTER COLUMN email_verified SET NOT NULL,
      ALTER COLUMN auth_provider SET DEFAULT 'otp',
      ALTER COLUMN auth_provider SET NOT NULL
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
    ON users (lower(trim(email)))
    WHERE email IS NOT NULL
      AND trim(email) <> ''
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_phone_unique'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_phone_unique UNIQUE (phone);
      END IF;
    END
    $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_auth_provider_check'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_auth_provider_check
        CHECK (auth_provider IN ('otp', 'google'));
      END IF;
    END
    $$;
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique_idx
    ON users (google_id)
    WHERE google_id IS NOT NULL
      AND trim(google_id) <> ''
  `);
}

async function ensureUserIdentityConstraints() {
  const client = await pool.connect();

  try {
    if (shouldSkipRuntimeSchemaMutation()) {
      await assertNoIdentityDuplicates(client);
      logger.info("User identity uniqueness constraints verified");
      return;
    }

    await client.query("BEGIN");
    await normalizeExistingEmails(client);
    await normalizeExistingPhones(client);
    await assertNoIdentityDuplicates(client);
    await createIdentityIndexes(client);
    await client.query("COMMIT");

    logger.info("User identity uniqueness constraints verified");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("User identity uniqueness constraint verification failed", {
      err,
    });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureUserIdentityConstraints,
};
