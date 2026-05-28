const os = require("os");

const counters = new Map();
const gauges = new Map();
const histograms = new Map();

const DEFAULT_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

function sanitizeMetricName(name) {
  return String(name || "")
    .replace(/[^a-zA-Z0-9_:]/g, "_")
    .replace(/^[^a-zA-Z_:]+/, "");
}

function sanitizeLabelName(name) {
  return String(name || "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^[^a-zA-Z_]+/, "");
}

function normalizeLabelValue(value) {
  if (value === null || value === undefined || value === "") return "unknown";
  return String(value).slice(0, 160);
}

function normalizeLabels(labels = {}) {
  return Object.entries(labels)
    .filter(([key]) => key)
    .map(([key, value]) => [sanitizeLabelName(key), normalizeLabelValue(value)])
    .sort(([a], [b]) => a.localeCompare(b));
}

function metricKey(name, labels = {}) {
  return `${sanitizeMetricName(name)}|${JSON.stringify(normalizeLabels(labels))}`;
}

function parseMetricKey(key) {
  const separator = key.indexOf("|");
  return {
    name: key.slice(0, separator),
    labels: JSON.parse(key.slice(separator + 1)),
  };
}

function incrementCounter(name, labels = {}, value = 1) {
  const normalizedName = sanitizeMetricName(name);
  const key = metricKey(normalizedName, labels);
  counters.set(key, (counters.get(key) || 0) + Number(value || 1));
}

function setGauge(name, labels = {}, value = 0) {
  const normalizedName = sanitizeMetricName(name);
  const key = metricKey(normalizedName, labels);
  gauges.set(key, Number(value) || 0);
}

function observeHistogram(name, labels = {}, value = 0, buckets = DEFAULT_BUCKETS_MS) {
  const normalizedName = sanitizeMetricName(name);
  const normalizedLabels = normalizeLabels(labels);
  const key = metricKey(normalizedName, Object.fromEntries(normalizedLabels));
  const metric = histograms.get(key) || {
    buckets: [...buckets].sort((a, b) => a - b),
    counts: new Map(),
    count: 0,
    sum: 0,
  };
  const observed = Number(value) || 0;

  for (const bucket of metric.buckets) {
    if (observed <= bucket) {
      metric.counts.set(bucket, (metric.counts.get(bucket) || 0) + 1);
    }
  }

  metric.count += 1;
  metric.sum += observed;
  histograms.set(key, metric);
}

function statusClass(statusCode) {
  const status = Number(statusCode) || 0;
  if (status < 100) return "unknown";
  return `${Math.floor(status / 100)}xx`;
}

function recordHttpRequest({ method, route, statusCode, durationMs }) {
  const labels = {
    method: String(method || "UNKNOWN").toUpperCase(),
    route: route || "unmatched",
    status_class: statusClass(statusCode),
  };

  incrementCounter("food_rescue_http_requests_total", labels);
  observeHistogram("food_rescue_http_request_duration_ms", labels, durationMs);
}

function recordQueueJob({ queueName, event, durationMs, waitMs, retryExhausted = false }) {
  const labels = {
    queue: queueName || "unknown",
    event: event || "unknown",
    retry_exhausted: retryExhausted ? "true" : "false",
  };

  incrementCounter("food_rescue_queue_jobs_total", labels);
  if (durationMs !== undefined) {
    observeHistogram("food_rescue_queue_job_duration_ms", { queue: labels.queue, event: labels.event }, durationMs);
  }
  if (waitMs !== undefined) {
    observeHistogram("food_rescue_queue_job_wait_ms", { queue: labels.queue }, waitMs);
  }
}

function recordPaymentEvent({ eventName, severity = "info", status = "unknown" }) {
  incrementCounter("food_rescue_payment_events_total", {
    event: eventName || "unknown",
    severity,
    status,
  });
}

function recordReservationCreated({ pickupType, paymentStatus, source, count = 1 }) {
  incrementCounter(
    "food_rescue_reservations_created_total",
    {
      pickup_type: pickupType || "unknown",
      payment_status: paymentStatus || "unknown",
      source: source || "unknown",
    },
    count
  );
}

function setQueueCountGauge(queueName, state, value) {
  setGauge("food_rescue_queue_jobs_current", {
    queue: queueName,
    state,
  }, value);
}

function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function formatLabels(labels) {
  if (!labels.length) return "";
  return `{${labels.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",")}}`;
}

function appendMetricLine(lines, key, value) {
  const { name, labels } = parseMetricKey(key);
  lines.push(`${name}${formatLabels(labels)} ${Number(value) || 0}`);
}

function collectRuntimeGauges() {
  setGauge("food_rescue_process_uptime_seconds", {}, process.uptime());
  setGauge("food_rescue_process_memory_bytes", { type: "rss" }, process.memoryUsage().rss);
  setGauge("food_rescue_process_memory_bytes", { type: "heap_used" }, process.memoryUsage().heapUsed);
  setGauge("food_rescue_process_cpu_load", { window: "1m" }, os.loadavg()[0] || 0);
}

function getPrometheusMetrics() {
  collectRuntimeGauges();

  const lines = [
    "# HELP food_rescue_http_requests_total Total HTTP requests observed by the API process.",
    "# TYPE food_rescue_http_requests_total counter",
    "# HELP food_rescue_http_request_duration_ms HTTP request duration in milliseconds.",
    "# TYPE food_rescue_http_request_duration_ms histogram",
    "# HELP food_rescue_queue_jobs_total Queue job lifecycle events observed by workers.",
    "# TYPE food_rescue_queue_jobs_total counter",
    "# HELP food_rescue_payment_events_total Payment lifecycle events observed by the API/workers.",
    "# TYPE food_rescue_payment_events_total counter",
    "# HELP food_rescue_payment_ownership_snapshots_total Immutable financial ownership snapshot creation outcomes.",
    "# TYPE food_rescue_payment_ownership_snapshots_total counter",
    "# HELP food_rescue_reservations_created_total Reservation creation events.",
    "# TYPE food_rescue_reservations_created_total counter",
    "# HELP food_rescue_trust_events_ingested_total Trust ledger ingestion events.",
    "# TYPE food_rescue_trust_events_ingested_total counter",
    "# HELP food_rescue_trust_events_processed_total Trust worker processing outcomes.",
    "# TYPE food_rescue_trust_events_processed_total counter",
    "# HELP food_rescue_trust_event_retries_total Trust event retry attempts.",
    "# TYPE food_rescue_trust_event_retries_total counter",
    "# HELP food_rescue_trust_derived_events_total Trust events derived from committed lifecycle outcomes.",
    "# TYPE food_rescue_trust_derived_events_total counter",
    "# HELP food_rescue_trust_duplicate_events_total Duplicate trust ledger events skipped during ingestion.",
    "# TYPE food_rescue_trust_duplicate_events_total counter",
    "# HELP food_rescue_trust_projection_conflicts_total Idempotent trust projection conflicts skipped safely.",
    "# TYPE food_rescue_trust_projection_conflicts_total counter",
    "# HELP food_rescue_trust_projection_sql_failures_total SQL failures while applying trust projections.",
    "# TYPE food_rescue_trust_projection_sql_failures_total counter",
    "# HELP food_rescue_trust_worker_rollbacks_total Trust worker transaction and savepoint rollbacks.",
    "# TYPE food_rescue_trust_worker_rollbacks_total counter",
    "# HELP food_rescue_trust_worker_transaction_failures_total Trust worker transaction failures.",
    "# TYPE food_rescue_trust_worker_transaction_failures_total counter",
    "# HELP food_rescue_trust_worker_transaction_retries_total Trust worker retryable transaction retries.",
    "# TYPE food_rescue_trust_worker_transaction_retries_total counter",
    "# HELP food_rescue_trust_retry_safe_completions_total Trust events completed without duplicate projection side effects.",
    "# TYPE food_rescue_trust_retry_safe_completions_total counter",
    "# HELP food_rescue_trust_projected_restrictions_total Passive trust restriction recommendations projected.",
    "# TYPE food_rescue_trust_projected_restrictions_total counter",
    "# HELP food_rescue_trust_projected_cooldowns_total Passive trust cooldown recommendations projected.",
    "# TYPE food_rescue_trust_projected_cooldowns_total counter",
    "# HELP food_rescue_trust_projected_suspensions_total Passive trust suspension recommendations projected.",
    "# TYPE food_rescue_trust_projected_suspensions_total counter",
    "# HELP food_rescue_trust_score_decay_operations_total Passive trust decay operations applied during projection.",
    "# TYPE food_rescue_trust_score_decay_operations_total counter",
    "# HELP food_rescue_trust_recovery_operations_total Passive trust recovery operations applied during projection.",
    "# TYPE food_rescue_trust_recovery_operations_total counter",
    "# HELP food_rescue_trust_projection_rebuilds_total Passive trust projection rebuild outcomes.",
    "# TYPE food_rescue_trust_projection_rebuilds_total counter",
    "# HELP food_rescue_trust_projection_rebuild_duration_ms Passive trust projection rebuild duration.",
    "# TYPE food_rescue_trust_projection_rebuild_duration_ms histogram",
    "# HELP food_rescue_trust_replay_diagnostics_total Passive trust replay diagnostic checks.",
    "# TYPE food_rescue_trust_replay_diagnostics_total counter",
    "# HELP food_rescue_trust_replay_checksum_mismatches_total Passive trust replay checksum mismatches.",
    "# TYPE food_rescue_trust_replay_checksum_mismatches_total counter",
  ];

  for (const [key, value] of counters.entries()) {
    appendMetricLine(lines, key, value);
  }

  for (const [key, value] of gauges.entries()) {
    appendMetricLine(lines, key, value);
  }

  for (const [key, metric] of histograms.entries()) {
    const { name, labels } = parseMetricKey(key);
    for (const bucket of metric.buckets) {
      lines.push(`${name}_bucket${formatLabels([...labels, ["le", String(bucket)]])} ${metric.counts.get(bucket) || 0}`);
    }
    lines.push(`${name}_bucket${formatLabels([...labels, ["le", "+Inf"]])} ${metric.count}`);
    lines.push(`${name}_sum${formatLabels(labels)} ${metric.sum}`);
    lines.push(`${name}_count${formatLabels(labels)} ${metric.count}`);
  }

  return `${lines.join("\n")}\n`;
}

function snapshotMap(metricMap, limit = 200) {
  return Array.from(metricMap.entries())
    .slice(0, limit)
    .map(([key, value]) => ({
      ...parseMetricKey(key),
      value: Number(value) || 0,
    }));
}

function snapshotHistograms(limit = 100) {
  return Array.from(histograms.entries())
    .slice(0, limit)
    .map(([key, metric]) => ({
      ...parseMetricKey(key),
      count: metric.count,
      sum: metric.sum,
    }));
}

function getMetricsSnapshot() {
  collectRuntimeGauges();

  return {
    counters: counters.size,
    gauges: gauges.size,
    histograms: histograms.size,
    samples: {
      counters: snapshotMap(counters),
      gauges: snapshotMap(gauges),
      histograms: snapshotHistograms(),
    },
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
  };
}

function resetMetricsForTest() {
  counters.clear();
  gauges.clear();
  histograms.clear();
}

module.exports = {
  getMetricsSnapshot,
  getPrometheusMetrics,
  incrementCounter,
  observeHistogram,
  recordHttpRequest,
  recordPaymentEvent,
  recordQueueJob,
  recordReservationCreated,
  resetMetricsForTest,
  setGauge,
  setQueueCountGauge,
};
