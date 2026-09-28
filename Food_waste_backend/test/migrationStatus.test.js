const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertMigrationsCurrent,
  getMigrationIds,
} = require("../shared/config/migrationStatus");

function createMigrationDb({ outboxExists = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);

      if (sql.includes("schema_migrations')")) {
        return { rows: [{ table_name: "schema_migrations" }] };
      }

      if (sql.includes("FROM schema_migrations")) {
        return { rows: getMigrationIds().map((id) => ({ id })) };
      }

      return {
        rows: [{ notification_outbox: outboxExists ? "notification_outbox" : null }],
      };
    },
  };
}

test("migration verification rejects a missing notification outbox table", async () => {
  const db = createMigrationDb({ outboxExists: false });

  await assert.rejects(
    () => assertMigrationsCurrent({ db }),
    /notification_outbox is missing.*047_notification_outbox/
  );
  assert.equal(db.calls.length, 3);
});

test("migration verification accepts current migrations and required outbox table", async () => {
  const db = createMigrationDb();

  await assert.doesNotReject(() => assertMigrationsCurrent({ db }));
  assert.equal(db.calls.length, 3);
});