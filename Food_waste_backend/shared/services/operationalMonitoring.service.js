const pool = require("../config/db");
const redis = require("../config/redis");
const {
  monitoredQueueConfigs,
} = require("./queueObservability.service");
const {
  heartbeatAgeMs,
  heartbeatStatus: getHeartbeatStatus,
} = require("../utils/heartbeatStatus");

const WINDOW_OPTIONS = {
  "1h": { label: "Last Hour", hours: 1 },
  "24h": { label: "24 Hours", hours: 24 },
  "7d": { label: "7 Days", hours: 7 * 24 },
  "30d": { label: "30 Days", hours: 30 * 24 },
};

const STALE_HEARTBEAT_MS = Number(process.env.WORKER_STALE_HEARTBEAT_MS || 90000);
const QUEUE_BACKLOG_WARNING = Number(process.env.MONITOR_QUEUE_BACKLOG_WARNING || 50);
const QUEUE_BACKLOG_CRITICAL = Number(process.env.MONITOR_QUEUE_BACKLOG_CRITICAL || 250);
const workerRequirementByQueue = new Map(
  monitoredQueueConfigs.map(({ queue, workerRequired }) => [queue.name, Boolean(workerRequired)])
);

function toInt(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function normalizeWindow(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["last_hour", "last-hour", "hour", "1hour"].includes(raw)) return "1h";
  if (["24", "24hr", "24hrs", "24hour", "24hours", "day"].includes(raw)) return "24h";
  if (["7", "7day", "7days", "week"].includes(raw)) return "7d";
  if (["30", "30day", "30days", "month"].includes(raw)) return "30d";
  return WINDOW_OPTIONS[raw] ? raw : "24h";
}

function windowParam(windowKey) {
  return WINDOW_OPTIONS[windowKey] || WINDOW_OPTIONS["24h"];
}

function statusRank(status) {
  return { healthy: 0, warning: 1, critical: 2 }[status] ?? 1;
}

function worstStatus(statuses) {
  return statuses.reduce(
    (worst, status) => (statusRank(status) > statusRank(worst) ? status : worst),
    "healthy"
  );
}

function healthCard(id, label, status, detail, metric = null) {
  return { id, label, status, detail, metric };
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } catch {
    return fallback;
  }
}

async function checkDatabase() {
  const started = Date.now();
  await pool.query("SELECT 1");
  return {
    status: "healthy",
    latency_ms: Date.now() - started,
  };
}

async function checkRedis() {
  const started = Date.now();
  const pong = await redis.ping();
  return {
    status: pong ? "healthy" : "critical",
    latency_ms: Date.now() - started,
  };
}

function requiresWorkerHeartbeat(heartbeat) {
  const queueName = heartbeat?.queue_name || heartbeat?.worker_name;
  return workerRequirementByQueue.get(queueName) !== false;
}

async function getWorkerSnapshot() {
  const rows = await safeQuery(
    `
    SELECT worker_name, queue_name, status, last_job_id, last_seen_at, metadata,
           EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS seconds_since_seen
    FROM worker_heartbeats
    ORDER BY worker_name
    `,
    [],
    []
  );

  const workers = rows.map((worker) => {
    const workerRequired = requiresWorkerHeartbeat(worker);
    const ageMs = heartbeatAgeMs(worker);
    const stale = workerRequired && (ageMs === null || ageMs > STALE_HEARTBEAT_MS);
    const status = stale ? "stale" : worker.status || "running";
    const failed = ["failed", "error", "stalled"].includes(String(status));

    return {
      ...worker,
      worker_required: workerRequired,
      status,
      heartbeat_age_ms: ageMs,
      health_status:
        !workerRequired && !failed
          ? "healthy"
          : status === "running" || status === "processing"
            ? "healthy"
            : "critical",
    };
  });

  return {
    status: workers.some((worker) => worker.health_status === "critical")
      ? "critical"
      : "healthy",
    total: workers.length,
    stale: workers.filter((worker) => worker.status === "stale").length,
    failed: workers.filter((worker) =>
      ["failed", "error", "stalled"].includes(String(worker.status))
    ).length,
    workers,
  };
}

function queueHealthFromCounts({ counts, isPaused, heartbeat, workerRequired }) {
  const waiting = toInt(counts.waiting) + toInt(counts.delayed) + toInt(counts["waiting-children"]);
  const failed = toInt(counts.failed);
  const workerState = workerRequired
    ? getHeartbeatStatus(heartbeat, STALE_HEARTBEAT_MS)
    : "not_required";

  if (
    isPaused ||
    failed > 0 ||
    waiting >= QUEUE_BACKLOG_CRITICAL ||
    ["missing", "stale", "invalid"].includes(workerState)
  ) {
    return "critical";
  }

  if (waiting >= QUEUE_BACKLOG_WARNING) return "warning";
  return "healthy";
}

async function getQueueSnapshot() {
  const heartbeats = await safeQuery(
    `
    SELECT worker_name, queue_name, status, last_job_id, last_seen_at, metadata,
           EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS seconds_since_seen
    FROM worker_heartbeats
    ORDER BY worker_name
    `,
    [],
    []
  );
  const heartbeatsByQueue = new Map(
    heartbeats.map((heartbeat) => [heartbeat.queue_name || heartbeat.worker_name, heartbeat])
  );

  const queues = await Promise.all(
    monitoredQueueConfigs.map(async ({ queue, workerRequired, deadLetter }) => {
      const [counts, isPaused, failedJobs] = await Promise.all([
        queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "waiting-children"),
        queue.isPaused(),
        queue.getFailed(0, 4),
      ]);
      const heartbeat = heartbeatsByQueue.get(queue.name) || null;
      const status = queueHealthFromCounts({
        counts,
        isPaused,
        heartbeat,
        workerRequired,
      });

      return {
        name: queue.name,
        status,
        is_paused: Boolean(isPaused),
        category: deadLetter
          ? "Dead Letter"
          : queue.name.includes("trust")
            ? "Trust"
            : queue.name.includes("notification")
              ? "Notification"
              : queue.name.includes("payment") || queue.name.includes("refund")
                ? "Payment"
                : "Operational",
        counts: {
          waiting: toInt(counts.waiting),
          active: toInt(counts.active),
          completed: toInt(counts.completed),
          failed: toInt(counts.failed),
          delayed: toInt(counts.delayed),
          "waiting-children": toInt(counts["waiting-children"]),
        },
        worker_heartbeat_status: workerRequired
          ? getHeartbeatStatus(heartbeat, STALE_HEARTBEAT_MS)
          : "not_required",
        worker: heartbeat,
        drilldown_href: "/admin/queues",
        failed_jobs: failedJobs.map((job) => ({
          id: job.id,
          name: job.name,
          attemptsMade: job.attemptsMade,
          attempts: job.opts?.attempts || 1,
          failedReason: job.failedReason || null,
          timestamp: job.timestamp,
          processedOn: job.processedOn || null,
          finishedOn: job.finishedOn || null,
        })),
      };
    })
  );

  return {
    status: worstStatus(queues.map((queue) => queue.status)),
    totals: queues.reduce(
      (acc, queue) => {
        acc.waiting += toInt(queue.counts.waiting) + toInt(queue.counts.delayed);
        acc.active += toInt(queue.counts.active);
        acc.completed += toInt(queue.counts.completed);
        acc.failed += toInt(queue.counts.failed);
        return acc;
      },
      { waiting: 0, active: 0, completed: 0, failed: 0 }
    ),
    queues,
  };
}

async function getPaymentSnapshot(windowKey) {
  const { hours } = windowParam(windowKey);
  const [payments, webhooks, settlements, reconciliation, alerts] = await Promise.all([
    safeQuery(
      `
      SELECT
        COUNT(*) FILTER (WHERE status='pending')::int AS pending_payments,
        COUNT(*) FILTER (WHERE status IN ('failed','expired','abandoned','cancelled'))::int AS payment_errors,
        COUNT(*) FILTER (
          WHERE reconciliation_status IS NOT NULL
          AND reconciliation_status NOT IN ('terminal','pending_gateway')
        )::int AS reconciliation_attention_required
      FROM payments
      `,
      [],
      [{}]
    ),
    safeQuery(
      `
      SELECT
        COUNT(*) FILTER (WHERE status='failed')::int AS webhook_failures,
        COUNT(*) FILTER (WHERE status='processed')::int AS webhooks_processed
      FROM cashfree_webhook_events
      WHERE received_at >= NOW() - ($1::int * INTERVAL '1 hour')
      `,
      [hours],
      [{}]
    ),
    safeQuery(
      `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending','processing','allocated','batched'))::int AS pending_settlements,
        COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))::int AS failed_settlements,
        COUNT(*) FILTER (WHERE status IN ('paid','settled'))::int AS settled
      FROM provider_settlements
      `,
      [],
      [{}]
    ),
    safeQuery(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE last_reconciled_at >= NOW() - ($1::int * INTERVAL '1 hour')
        )::int AS recent_reconciliation_runs,
        MAX(last_reconciled_at) AS last_reconciled_at
      FROM payments
      `,
      [hours],
      [{}]
    ),
    safeQuery(
      `
      SELECT COUNT(*)::int AS open_payment_alerts
      FROM operational_alerts
      WHERE status='open'
      AND category IN ('payment','financial')
      `,
      [],
      [{}]
    ),
  ]);

  const row = payments[0] || {};
  const webhookRow = webhooks[0] || {};
  const settlementRow = settlements[0] || {};
  const reconciliationRow = reconciliation[0] || {};
  const openAlerts = toInt(alerts[0]?.open_payment_alerts);
  const issueCount =
    toInt(row.payment_errors) +
    toInt(row.reconciliation_attention_required) +
    toInt(webhookRow.webhook_failures) +
    toInt(settlementRow.failed_settlements) +
    openAlerts;

  return {
    status: issueCount > 0 ? "critical" : "healthy",
    pending_settlements: toInt(settlementRow.pending_settlements),
    failed_settlements: toInt(settlementRow.failed_settlements),
    settled: toInt(settlementRow.settled),
    recent_reconciliation_runs: toInt(reconciliationRow.recent_reconciliation_runs),
    last_reconciled_at: reconciliationRow.last_reconciled_at || null,
    payment_errors: toInt(row.payment_errors),
    pending_payments: toInt(row.pending_payments),
    webhook_failures: toInt(webhookRow.webhook_failures),
    webhooks_processed: toInt(webhookRow.webhooks_processed),
    reconciliation_attention_required: toInt(row.reconciliation_attention_required),
    open_alerts: openAlerts,
    drilldowns: {
      financial_diagnostics: "/admin/audit-center?domains=financial",
      audit_center: "/admin/audit-center?domains=financial",
    },
  };
}

async function getNotificationSnapshot(windowKey, queues, socketSnapshot) {
  const { hours } = windowParam(windowKey);
  const notificationQueue = queues.find((queue) => queue.name === "notification-queue");
  const rows = await safeQuery(
    `
    SELECT
      COUNT(*)::int AS sent,
      COUNT(*) FILTER (WHERE type LIKE 'moderation_%' OR type LIKE 'provider_%')::int AS moderation_notifications,
      COUNT(*) FILTER (WHERE type LIKE 'admin_%' OR type LIKE 'ngo_%')::int AS operational_notifications
    FROM notifications
    WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
    `,
    [hours],
    [{}]
  );
  const failed = toInt(notificationQueue?.counts?.failed);
  const backlog =
    toInt(notificationQueue?.counts?.waiting) + toInt(notificationQueue?.counts?.delayed);

  return {
    status: failed > 0 ? "critical" : backlog > 0 ? "warning" : "healthy",
    notifications_sent: toInt(rows[0]?.sent),
    notifications_failed: failed,
    moderation_notifications: toInt(rows[0]?.moderation_notifications),
    operational_notifications: toInt(rows[0]?.operational_notifications),
    notification_backlog: backlog,
    realtime_delivery_status: socketSnapshot.status,
    drilldown_href: "/admin/audit-center?domains=notifications",
  };
}

function getSocketSnapshot(io, redisStatus) {
  const connectedClients = io?.engine?.clientsCount || 0;
  const status = io && redisStatus !== "critical" ? "healthy" : "warning";

  return {
    status,
    connected_clients: connectedClients,
    recent_disconnects: null,
    realtime_sync_health: redisStatus === "critical" ? "critical" : "healthy",
    socket_errors: null,
    note: "Disconnect and socket error counts are not currently persisted; connected clients and Redis bridge health are live process observations.",
  };
}

async function getTrustSnapshot(windowKey, queues) {
  const { hours } = windowParam(windowKey);
  const trustQueue = queues.find((queue) => queue.name === "trust-queue");
  const [processingRows, processedRows, replayRows] = await Promise.all([
    safeQuery(
      `
      SELECT
        COUNT(*) FILTER (WHERE processing_status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE processing_status='retry')::int AS retry,
        COUNT(*) FILTER (WHERE processing_status='processing')::int AS processing,
        COUNT(*) FILTER (WHERE processing_status='failed')::int AS failed
      FROM trust_events
      WHERE processing_status IN ('pending','retry','processing','failed')
      `,
      [],
      [{}]
    ),
    safeQuery(
      `
      SELECT COUNT(*)::int AS processed
      FROM trust_events
      WHERE processing_status='processed'
      AND COALESCE(processed_at, created_at) >= NOW() - ($1::int * INTERVAL '1 hour')
      `,
      [hours],
      [{}]
    ),
    safeQuery(
      `
      SELECT
        COUNT(*)::int AS recent_replay_activity,
        MAX(created_at) AS last_replay_at
      FROM operational_events
      WHERE category='trust'
      AND event_name LIKE '%replay%'
      AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
      `,
      [hours],
      [{}]
    ),
  ]);

  const processing = processingRows[0] || {};
  const failures = toInt(processing.failed);
  const waiting = toInt(processing.pending) + toInt(processing.retry);

  return {
    status: failures > 0 ? "critical" : waiting > 0 ? "warning" : "healthy",
    trust_events_waiting: waiting,
    trust_events_processed: toInt(processedRows[0]?.processed),
    projection_failures: failures,
    recent_replay_activity: toInt(replayRows[0]?.recent_replay_activity),
    last_replay_at: replayRows[0]?.last_replay_at || null,
    queue: trustQueue || null,
    drilldown_href: "/admin/trust",
  };
}

async function getGovernanceSnapshot() {
  const [cases, appeals] = await Promise.all([
    safeQuery(
      `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('OPEN','UNDER_REVIEW','AWAITING_RESPONSE','ESCALATED'))::int AS open_moderation_cases,
        COUNT(*) FILTER (WHERE status='ESCALATED')::int AS escalations_pending
      FROM moderation_cases
      `,
      [],
      [{}]
    ),
    safeQuery(
      `
      SELECT COUNT(*) FILTER (WHERE status='SUBMITTED')::int AS appeals_pending_review
      FROM moderation_appeals
      `,
      [],
      [{}]
    ),
  ]);

  return {
    status: toInt(cases[0]?.escalations_pending) > 0 ? "warning" : "healthy",
    open_moderation_cases: toInt(cases[0]?.open_moderation_cases),
    appeals_pending_review: toInt(appeals[0]?.appeals_pending_review),
    escalations_pending: toInt(cases[0]?.escalations_pending),
    drilldowns: {
      governance_dashboard: "/admin/governance-dashboard",
      governance_intelligence: "/admin/governance-intelligence",
      appeals: "/admin/moderation-appeals",
    },
  };
}

async function getOpenAlerts() {
  return safeQuery(
    `
    SELECT id, alert_key, category, severity, message, metadata, status,
           first_seen_at, last_seen_at, occurrences
    FROM operational_alerts
    WHERE status='open'
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
      last_seen_at DESC
    LIMIT 50
    `,
    [],
    []
  );
}

function buildDerivedAlerts({ queues, payment, trust, worker }) {
  const alerts = [];

  for (const queue of queues) {
    const backlog = toInt(queue.counts.waiting) + toInt(queue.counts.delayed);
    if (backlog >= QUEUE_BACKLOG_WARNING) {
      alerts.push({
        alert_key: `readonly:${queue.name}:backlog`,
        category: "queue",
        severity: backlog >= QUEUE_BACKLOG_CRITICAL ? "critical" : "warning",
        message: `${queue.name} backlog is ${backlog} jobs`,
        source: "derived_readonly",
        drilldown_href: "/admin/queues",
      });
    }
    if (toInt(queue.counts.failed) > 0) {
      alerts.push({
        alert_key: `readonly:${queue.name}:failed`,
        category: "queue",
        severity: "critical",
        message: `${queue.name} has ${toInt(queue.counts.failed)} failed jobs`,
        source: "derived_readonly",
        drilldown_href: "/admin/queues",
      });
    }
  }

  if (worker.failed > 0 || worker.stale > 0) {
    alerts.push({
      alert_key: "readonly:worker:failure",
      category: "worker",
      severity: "critical",
      message: `${worker.failed + worker.stale} workers are failed or stale`,
      source: "derived_readonly",
      drilldown_href: "/admin/queues",
    });
  }

  if (payment.failed_settlements > 0) {
    alerts.push({
      alert_key: "readonly:payment:settlement_failure",
      category: "payment",
      severity: "critical",
      message: `${payment.failed_settlements} settlement records are cancelled`,
      source: "derived_readonly",
      drilldown_href: "/admin/audit-center?domains=financial",
    });
  }

  if (payment.webhook_failures > 0) {
    alerts.push({
      alert_key: "readonly:payment:webhook_failure",
      category: "payment",
      severity: "critical",
      message: `${payment.webhook_failures} webhook failures in the selected window`,
      source: "derived_readonly",
      drilldown_href: "/admin/audit-center?domains=financial",
    });
  }

  if (trust.projection_failures > 0) {
    alerts.push({
      alert_key: "readonly:trust:processing_failure",
      category: "trust",
      severity: "critical",
      message: `${trust.projection_failures} trust events failed processing`,
      source: "derived_readonly",
      drilldown_href: "/admin/trust",
    });
  }

  return alerts;
}

async function getOperationalMonitoring(options = {}) {
  const windowKey = normalizeWindow(options.window);
  const generatedAt = new Date().toISOString();

  const [databaseResult, redisResult, worker, queue] = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    getWorkerSnapshot(),
    getQueueSnapshot(),
  ]);

  const database =
    databaseResult.status === "fulfilled"
      ? databaseResult.value
      : { status: "critical", error: databaseResult.reason?.message };
  const redisHealth =
    redisResult.status === "fulfilled"
      ? redisResult.value
      : { status: "critical", error: redisResult.reason?.message };
  const workerSnapshot =
    worker.status === "fulfilled"
      ? worker.value
      : { status: "critical", total: 0, stale: 0, failed: 0, workers: [] };
  const queueSnapshot =
    queue.status === "fulfilled"
      ? queue.value
      : { status: "critical", totals: {}, queues: [] };

  const socket = getSocketSnapshot(options.io, redisHealth.status);
  const [payment, notification, trust, governance, openAlerts] = await Promise.all([
    getPaymentSnapshot(windowKey),
    getNotificationSnapshot(windowKey, queueSnapshot.queues, socket),
    getTrustSnapshot(windowKey, queueSnapshot.queues),
    getGovernanceSnapshot(),
    getOpenAlerts(),
  ]);

  const health = [
    healthCard("api", "API Health", "healthy", "Monitoring endpoint responded", {
      uptime_seconds: Math.round(process.uptime()),
    }),
    healthCard("database", "Database Health", database.status, "PostgreSQL read probe", database),
    healthCard("redis", "Redis Health", redisHealth.status, "Redis ping probe", redisHealth),
    healthCard("worker", "Worker Health", workerSnapshot.status, "Worker heartbeat table", {
      total: workerSnapshot.total,
      stale: workerSnapshot.stale,
      failed: workerSnapshot.failed,
    }),
    healthCard("socket", "Socket Health", socket.status, "Socket.IO process snapshot", {
      connected_clients: socket.connected_clients,
    }),
  ];

  const derivedAlerts = buildDerivedAlerts({
    queues: queueSnapshot.queues,
    payment,
    trust,
    worker: workerSnapshot,
  });

  return {
    generated_at: generatedAt,
    window: {
      key: windowKey,
      ...windowParam(windowKey),
    },
    status: worstStatus([
      ...health.map((item) => item.status),
      queueSnapshot.status,
      payment.status,
      notification.status,
      trust.status,
      governance.status,
    ]),
    read_only: true,
    health,
    queues: queueSnapshot,
    payments: payment,
    notifications: notification,
    sockets: socket,
    trust,
    governance,
    alerts: {
      open: openAlerts,
      derived: derivedAlerts,
    },
    drilldowns: [
      { label: "Audit Center", href: "/admin/audit-center" },
      { label: "Governance Dashboard", href: "/admin/governance-dashboard" },
      { label: "Trust View", href: "/admin/trust" },
      { label: "Queue Diagnostics", href: "/admin/queues" },
      { label: "Financial Diagnostics", href: "/admin/audit-center?domains=financial" },
    ],
    analysis: {
      architecture: [
        "Payments reuse Cashfree webhook audit rows, payment reconciliation columns, provider settlement rows, and immutable financial audit sources.",
        "Queues reuse the BullMQ queue registry and worker heartbeat table while avoiding retry, cleanup, or alert-writing paths.",
        "Trust processing reuses trust_events processing statuses and the trust queue, without rebuilding projections or changing trust formulas.",
        "Governance uses moderation case and appeal status aggregates already powering the governance dashboard.",
        "Notifications and realtime visibility reuse notifications, notification queue counts, Redis health, and the live Socket.IO client count.",
      ],
      gaps: [
        "Socket disconnect and socket error counts are not persisted, so the dashboard marks those fields as unavailable instead of inferring them.",
        "Notification delivery failure is represented by notification queue failures and operational alerts; individual push outcomes are not stored.",
        "Settlement failures include failed and legacy cancelled provider_settlements plus financial alerts.",
      ],
      risks: [
        "Health can be stale when worker heartbeat writes stop but Redis and API remain reachable.",
        "Queue count reads are inexpensive, but frequent polling still touches Redis for every monitored queue.",
        "Derived read-only alerts may duplicate persisted operational alerts by design; the source field separates them.",
        "False alarms are possible for intentionally paused workers or planned settlement holds.",
      ],
      reuse: [
        "BullMQ monitoredQueueConfigs",
        "worker_heartbeats",
        "operational_alerts",
        "cashfree_webhook_events",
        "payments reconciliation fields",
        "provider_settlements",
        "trust_events",
        "moderation_cases and moderation_appeals",
        "notifications",
      ],
    },
  };
}

module.exports = {
  getOperationalMonitoring,
  normalizeWindow,
};
