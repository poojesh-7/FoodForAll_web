const pool = require("../shared/config/db");
const bullmqConnection = require("../shared/config/bullmq");
const {
  evaluateRequiredWorkerHeartbeats,
} = require("../shared/utils/workerHealthcheck");

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function checkRedis() {
  const pong = await bullmqConnection.ping();
  if (!pong) {
    fail("BullMQ Redis ping failed");
  }
}

async function getWorkerHeartbeats() {
  const result = await pool.query(`
    SELECT worker_name, queue_name, status,
           EXTRACT(EPOCH FROM (NOW() - last_seen_at)) * 1000 AS age_ms
    FROM worker_heartbeats
  `);

  return result.rows;
}

async function closeResources() {
  await pool.end().catch(() => {});

  if (bullmqConnection.status === "ready") {
    await bullmqConnection.quit().catch(() => bullmqConnection.disconnect());
  } else if (bullmqConnection.status !== "end") {
    bullmqConnection.disconnect();
  }
}

async function main() {
  await checkRedis();

  const staleMs = Number(process.env.WORKER_STALE_HEARTBEAT_MS || 90000);
  const evaluation = evaluateRequiredWorkerHeartbeats(await getWorkerHeartbeats(), {
    staleMs,
  });

  if (!evaluation.healthy) {
    fail("Required worker heartbeats are unhealthy", evaluation);
  }

  process.stdout.write("Worker healthcheck passed\n");
}

main()
  .catch((err) => {
    const details = err.details ? ` ${JSON.stringify(err.details)}` : "";
    process.stderr.write(`${err.message}${details}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeResources());
