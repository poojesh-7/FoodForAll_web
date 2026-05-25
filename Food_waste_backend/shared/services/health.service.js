const pool = require("../config/db");
const redis = require("../config/redis");
const { getQueueHealth } = require("./queueObservability.service");
const { getPaymentHealth } = require("./paymentMonitoring.service");
const { ensureObservabilitySchema } = require("./observability.service");
const {
  getMetricsSnapshot,
  setGauge,
} = require("./metrics.service");

async function checkDatabase() {
  const started = Date.now();
  await pool.query("SELECT 1");
  const latencyMs = Date.now() - started;
  setGauge("food_rescue_dependency_health", { dependency: "database" }, 1);
  setGauge("food_rescue_dependency_latency_ms", { dependency: "database" }, latencyMs);
  return { status: "healthy", latencyMs };
}

async function checkRedis() {
  const started = Date.now();
  const pong = await redis.ping();
  const status = pong ? "healthy" : "degraded";
  const latencyMs = Date.now() - started;
  setGauge("food_rescue_dependency_health", { dependency: "redis" }, status === "healthy" ? 1 : 0);
  setGauge("food_rescue_dependency_latency_ms", { dependency: "redis" }, latencyMs);
  return { status, latencyMs };
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

async function getOpenAlertSummary() {
  try {
    await ensureObservabilitySchema();
    const result = await pool.query(`
      SELECT category, severity, COUNT(*)::int AS count
      FROM operational_alerts
      WHERE status='open'
      GROUP BY category, severity
      ORDER BY category, severity
    `);
    return result.rows;
  } catch {
    return [];
  }
}

async function getHealth({ io } = {}) {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    getWorkerHealth(),
    getOpenAlertSummary(),
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
  const alerts =
    checks[3].status === "fulfilled"
      ? checks[3].value
      : [];
  const staleWorkers = workers.filter((worker) =>
    ["stale", "failed", "error"].includes(worker.status)
  );
  const websocket = {
    status: io ? "healthy" : "unavailable",
    connectedClients: io?.engine?.clientsCount || 0,
  };

  setGauge("food_rescue_websocket_clients", {}, websocket.connectedClients);
  setGauge("food_rescue_worker_heartbeat_stale", {}, staleWorkers.length);

  const status =
    database.status === "healthy" &&
    redisHealth.status === "healthy" &&
    staleWorkers.length === 0
      ? "healthy"
      : "degraded";

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    service: {
      name: process.env.SERVICE_NAME || "food_waste_backend",
      appEnv: process.env.APP_ENV,
      nodeEnv: process.env.NODE_ENV,
      pid: process.pid,
    },
    database,
    redis: redisHealth,
    websocket,
    workers,
    alerts,
    metrics: getMetricsSnapshot(),
  };
}

async function getQueueHealthCheck() {
  const queues = await getQueueHealth({ includeJobs: true });
  const degraded = queues.some((queue) => queue.status !== "healthy");
  setGauge("food_rescue_queue_degraded", {}, degraded ? 1 : 0);

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
  const mismatches = Number(payments.diagnostics?.reservation_payment_mismatches || 0);
  setGauge("food_rescue_payment_stale_sessions", {}, staleSessions);
  setGauge("food_rescue_payment_webhook_failures_24h", {}, webhookFailures);

  return {
    status: webhookFailures > 0 || staleSessions > 0 || mismatches > 0 ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    payments,
  };
}

module.exports = {
  getHealth,
  getPaymentHealthCheck,
  getQueueHealthCheck,
};
