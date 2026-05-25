const assert = require("node:assert/strict");
const test = require("node:test");

const {
  beginTransaction,
  isRetryableTransactionError,
  withTransaction,
} = require("../shared/utils/transaction");

function createClient({ failOnce = false } = {}) {
  const queries = [];
  let failed = false;

  return {
    queries,
    released: false,
    async query(sql) {
      queries.push(sql);
      if (failOnce && !failed && sql === "SELECT 1") {
        failed = true;
        const error = new Error("deadlock");
        error.code = "40P01";
        throw error;
      }
      return { rows: [] };
    },
    release() {
      this.released = true;
    },
  };
}

test("beginTransaction applies transaction-local timeouts", async () => {
  const client = createClient();

  await beginTransaction(client, {
    lockTimeoutMs: 1234,
    statementTimeoutMs: 5678,
    idleInTransactionTimeoutMs: 9012,
  });

  assert.equal(client.queries[0], "BEGIN");
  assert.equal(
    client.queries.filter((sql) => String(sql).includes("set_config")).length,
    3
  );
});

test("withTransaction retries deadlocks and releases clients", async () => {
  const firstClient = createClient({ failOnce: true });
  const secondClient = createClient();
  const clients = [firstClient, secondClient];
  const pool = {
    connect: async () => clients.shift(),
  };
  let attempts = 0;

  await withTransaction(
    pool,
    async (client) => {
      attempts += 1;
      await client.query("SELECT 1");
    },
    { maxAttempts: 2, retryDelayMs: 0 }
  );

  assert.equal(attempts, 2);
  assert.equal(firstClient.released, true);
  assert.equal(secondClient.released, true);
});

test("isRetryableTransactionError identifies deadlock and serialization failures", () => {
  assert.equal(isRetryableTransactionError({ code: "40P01" }), true);
  assert.equal(isRetryableTransactionError({ code: "40001" }), true);
  assert.equal(isRetryableTransactionError({ code: "55P03" }), true);
  assert.equal(isRetryableTransactionError({ code: "23505" }), false);
});
