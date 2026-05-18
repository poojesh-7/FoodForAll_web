const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./load-env");

loadEnv();

const pool = require("../shared/config/db");
const { validateEnvironment } = require("../shared/config/env");

const migrationsDir = path.resolve(__dirname, "../migrations");

function listMigrations(kind) {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(`.${kind}.sql`))
    .map((file) => ({
      id: file.replace(`.${kind}.sql`, ""),
      file,
      sql: fs.readFileSync(path.join(migrationsDir, file), "utf8"),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query("SELECT id FROM schema_migrations ORDER BY id");
  return result.rows.map((row) => row.id);
}

async function migrateUp() {
  validateEnvironment();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureMigrationTable(client);
    const applied = new Set(await getAppliedMigrations(client));
    const pending = listMigrations("up").filter((migration) => !applied.has(migration.id));

    for (const migration of pending) {
      process.stdout.write(`Applying ${migration.id}\n`);
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [
        migration.id,
      ]);
    }

    await client.query("COMMIT");
    process.stdout.write(
      pending.length ? `Applied ${pending.length} migration(s)\n` : "No migrations pending\n"
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function rollbackOne() {
  validateEnvironment();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureMigrationTable(client);
    const applied = await getAppliedMigrations(client);
    const latest = applied[applied.length - 1];

    if (!latest) {
      process.stdout.write("No migrations to roll back\n");
      await client.query("COMMIT");
      return;
    }

    const downPath = path.join(migrationsDir, `${latest}.down.sql`);
    if (!fs.existsSync(downPath)) {
      throw new Error(`Rollback file missing for migration ${latest}`);
    }

    process.stdout.write(`Rolling back ${latest}\n`);
    await client.query(fs.readFileSync(downPath, "utf8"));
    await client.query("DELETE FROM schema_migrations WHERE id=$1", [latest]);
    await client.query("COMMIT");
    process.stdout.write(`Rolled back ${latest}\n`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

const direction = process.argv[2] || "up";

(direction === "down" ? rollbackOne() : migrateUp()).catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
