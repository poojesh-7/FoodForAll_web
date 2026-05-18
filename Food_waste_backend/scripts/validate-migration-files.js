const fs = require("fs");
const path = require("path");

const migrationsDir = path.resolve(__dirname, "../migrations");
const files = fs.readdirSync(migrationsDir);
const up = files.filter((file) => file.endsWith(".up.sql")).sort();
const down = new Set(files.filter((file) => file.endsWith(".down.sql")));

if (!up.length) {
  throw new Error("At least one migration is required");
}

for (const file of up) {
  const rollback = file.replace(".up.sql", ".down.sql");
  if (!down.has(rollback)) {
    throw new Error(`Missing rollback migration for ${file}`);
  }
}

process.stdout.write(`Validated ${up.length} migration file pair(s)\n`);
