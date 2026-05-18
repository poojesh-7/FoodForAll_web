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

async function assertMigrationsCurrent() {
  const expected = getMigrationIds();

  if (!expected.length) return;

  const result = await pool.query(`
    SELECT to_regclass('public.schema_migrations') AS table_name
  `);

  if (!result.rows[0]?.table_name) {
    throw new Error("Database migrations have not been initialized");
  }

  const appliedResult = await pool.query(`
    SELECT id
    FROM schema_migrations
    ORDER BY id
  `);
  const applied = new Set(appliedResult.rows.map((row) => row.id));
  const missing = expected.filter((id) => !applied.has(id));

  if (missing.length) {
    throw new Error(`Database migrations are missing: ${missing.join(", ")}`);
  }
}

module.exports = {
  assertMigrationsCurrent,
  getMigrationIds,
};
