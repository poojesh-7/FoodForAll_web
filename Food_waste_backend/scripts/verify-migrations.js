const { loadEnv } = require("./load-env");

loadEnv();

const pool = require("../shared/config/db");
const { validateEnvironment } = require("../shared/config/env");
const { assertMigrationsCurrent } = require("../shared/config/migrationStatus");

(async () => {
  validateEnvironment();
  await assertMigrationsCurrent();
  await pool.end();
  process.stdout.write("Database migrations are current\n");
})().catch(async (err) => {
  await pool.end().catch(() => {});
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
