const fs = require("fs");
const path = require("path");
const pool = require("./db");

const migrationsDir = path.resolve(__dirname, "../../migrations");

function getMigrationIds() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".up.sql"))
    .map((file) => file.replace(/\.up\.sql$/, ""))
    .sort();
}

async function assertMigrationsCurrent(options = {}) {
  const db = options.db || pool;
  const expected = getMigrationIds();

  if (!expected.length) return;

  const result = await db.query(`
    SELECT to_regclass('public.schema_migrations') AS table_name
  `);

  if (!result.rows[0]?.table_name) {
    throw new Error("Database migrations have not been initialized");
  }

  const appliedResult = await db.query(`
    SELECT id
    FROM schema_migrations
    ORDER BY id
  `);
  const applied = new Set(appliedResult.rows.map((row) => row.id));
  const missing = expected.filter((id) => !applied.has(id));

  if (missing.length) {
    throw new Error(`Database migrations are missing: ${missing.join(", ")}`);
  }

  const runtimeSchema = await db.query(`
    SELECT to_regclass('notification_outbox') AS notification_outbox
  `);

  if (!runtimeSchema.rows[0]?.notification_outbox) {
    throw new Error(
      "Required table notification_outbox is missing; apply migration 047_notification_outbox"
    );
  }
}

module.exports = {
  assertMigrationsCurrent,
  getMigrationIds,
};
