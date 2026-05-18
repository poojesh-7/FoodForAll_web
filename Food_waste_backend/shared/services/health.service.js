const pool = require("../config/db");
const redis = require("../config/redis");
const { getQueueHealth } = require("./queueObservability.service");
const { getPaymentHealth } = require("./paymentMonitoring.service");
const { ensureObservabilitySchema } = require("./observability.service");

async function checkDatabase() {
  const started = Date.now();
  await pool.query("SELECT 1");
  return { status: "healthy", latencyMs: Date.now() - started };
}

async function checkRedis() {
  const started = Date.now();
  const pong = await redis.ping();
  return { status: pong ? "healthy" : "degraded", latencyMs: Date.now() - started };
}

async function getWorkerHealth() {
  await ensureObservabilitySchema();
  const result = await pool.query(`
    SELECT worker_name, queue_name, status, last_job_id, last_seen_at,
           EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS seconds_since_seen
    FROM worker_heartbeats
    ORDER BY worker_name
  `);

  return result.rows.map((worker) => ({
    ...worker,
    status:
      Number(worker.seconds_since_seen) > 10 * 60
        ? "stale"
        : worker.status,
  }));
}

async function getHealth({ io } = {}) {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    getWorkerHealth(),
  ]);

  const database =
    checks[0].status === "fulfilled"
      ? checks[0].value
      : { status: "unhealthy", error: checks[0].reason?.message };
  const redisHealth =
    checks[1].status === "fulfilled"
      ? checks[1].value
      : { status: "unhealthy", error: checks[1].reason?.message };
  const workers =
    checks[2].status === "fulfilled"
      ? checks[2].value
      : [];
  const websocket = {
    status: io ? "healthy" : "unavailable",
    connectedClients: io?.engine?.clientsCount || 0,
  };
  const status =
    database.status === "healthy" && redisHealth.status === "healthy"
      ? "healthy"
      : "degraded";

  return {
    status,
    timestamp: new Date().toISOString(),
    database,
    redis: redisHealth,
    websocket,
    workers,
  };
}

async function getQueueHealthCheck() {
  const queues = await getQueueHealth({ includeJobs: true });
  const degraded = queues.some((queue) => queue.status !== "healthy");

  return {
    status: degraded ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    queues,
  };
}

async function getPaymentHealthCheck() {
  const payments = await getPaymentHealth();
  const webhookFailures = Number(payments.webhooks?.failed || 0);
  const staleSessions = Number(payments.summary?.stale_sessions || 0);

  return {
    status: webhookFailures > 0 || staleSessions > 0 ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    payments,
  };
}

module.exports = {
  getHealth,
  getPaymentHealthCheck,
  getQueueHealthCheck,
};
