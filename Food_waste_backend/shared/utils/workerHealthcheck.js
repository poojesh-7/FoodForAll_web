const REQUIRED_WORKER_NAMES = Object.freeze([
  "expiry-queue",
  "expiry-alert-queue",
  "pickup-queue",
  "delivery-queue",
  "notification-queue",
  "payment-queue",
  "refund-queue",
  "trust-queue",
  "operational-cleanup-queue",
]);

const HEALTHY_WORKER_STATUSES = new Set(["running", "processing"]);

function normalizeWorkerRow(row = {}) {
  const workerName = row.worker_name || row.workerName;
  const status = String(row.status || "").toLowerCase();
  const ageMs =
    row.age_ms !== undefined && row.age_ms !== null
      ? Number(row.age_ms)
      : Number(row.seconds_since_seen || 0) * 1000;

  return {
    ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null,
    status,
    workerName,
  };
}

function evaluateRequiredWorkerHeartbeats(rows, options = {}) {
  const requiredWorkerNames = options.requiredWorkerNames || REQUIRED_WORKER_NAMES;
  const staleMs = Number(options.staleMs || process.env.WORKER_STALE_HEARTBEAT_MS || 90000);
  const byName = new Map();

  for (const row of rows || []) {
    const normalized = normalizeWorkerRow(row);
    if (normalized.workerName) {
      byName.set(normalized.workerName, normalized);
    }
  }

  const failures = [];

  for (const workerName of requiredWorkerNames) {
    const heartbeat = byName.get(workerName);

    if (!heartbeat) {
      failures.push({ workerName, reason: "missing" });
      continue;
    }

    if (!HEALTHY_WORKER_STATUSES.has(heartbeat.status)) {
      failures.push({
        workerName,
        reason: "unhealthy_status",
        status: heartbeat.status || "unknown",
      });
      continue;
    }

    if (heartbeat.ageMs === null || heartbeat.ageMs > staleMs) {
      failures.push({
        workerName,
        reason: "stale",
        ageMs: heartbeat.ageMs,
        staleMs,
      });
    }
  }

  return {
    healthy: failures.length === 0,
    failures,
    requiredWorkerNames,
    staleMs,
  };
}

module.exports = {
  HEALTHY_WORKER_STATUSES,
  REQUIRED_WORKER_NAMES,
  evaluateRequiredWorkerHeartbeats,
};
