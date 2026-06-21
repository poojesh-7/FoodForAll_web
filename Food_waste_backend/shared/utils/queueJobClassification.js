const DELAYED_OVERDUE_MS = Number(process.env.QUEUE_DELAYED_OVERDUE_MS || 2 * 60 * 1000);
const DELAYED_CLEANUP_CANDIDATE_MS = Number(
  process.env.QUEUE_DELAYED_CLEANUP_CANDIDATE_MS || 24 * 60 * 60 * 1000
);

const EXPECTED_DELAYED_JOBS = {
  "expiry-queue": {
    "expire-food": "Listing expiry scheduled for pickup end time.",
  },
  "expiry-alert-queue": {
    "expiry-alert": "Free listing rescue alert scheduled before pickup end time.",
  },
  "pickup-queue": {
    "pickup-timeout": "NGO volunteer pickup timeout guard.",
  },
  "delivery-queue": {
    "delivery-timeout": "NGO volunteer delivery timeout guard.",
  },
  "payment-queue": {
    "payment-timeout": "Payment hold timeout guard.",
    "payment-reconciliation-sweep": "Repeat payment recovery sweep.",
  },
  "financial-reconciliation-queue": {
    "financial-reconciliation-sweep": "Repeat financial artifact repair sweep.",
  },
  "refund-queue": {
    "refund-reconciliation-sweep": "Repeat refund recovery sweep.",
  },
  "trust-queue": {
    "process-trust-events": "Repeat trust projection sweep or targeted event processing.",
    "derive-lifecycle-trust-events": "Repeat lifecycle trust derivation sweep.",
  },
  "operational-cleanup-queue": {
    "operational-retention-cleanup": "Repeat retention cleanup sweep.",
  },
};

function classifyDelayedJob(queueName, job, now = Date.now()) {
  const dueAtMs =
    job?.delay && job?.timestamp
      ? Number(job.timestamp) + Number(job.delay)
      : 0;
  const overdueMs = dueAtMs > 0 ? now - dueAtMs : 0;
  const attempts = Number(job?.opts?.attempts || 1);
  const attemptsMade = Number(job?.attemptsMade || 0);
  const expectedReason = EXPECTED_DELAYED_JOBS[queueName]?.[job?.name] || null;
  const repeatJob = Boolean(job?.opts?.repeat || job?.repeatJobKey);

  if (attemptsMade > 0 && attemptsMade < attempts) {
    return {
      delayed_classification: "retry_pending",
      delayed_reason: "BullMQ backoff retry is waiting for its next attempt.",
      expected_delay: true,
      overdue_ms: Math.max(0, overdueMs),
      recovery_hint: "Allow the configured retry policy to continue unless attempts are exhausted.",
    };
  }

  if (overdueMs > DELAYED_CLEANUP_CANDIDATE_MS) {
    return {
      delayed_classification: "cleanup_candidate",
      delayed_reason: "Delayed job is overdue beyond the cleanup-candidate threshold.",
      expected_delay: Boolean(expectedReason || repeatJob),
      overdue_ms: overdueMs,
      recovery_hint: "Inspect Bull Board and source state before removing or retrying.",
    };
  }

  if (overdueMs > DELAYED_OVERDUE_MS) {
    return {
      delayed_classification: "stale",
      delayed_reason: "Delayed job due time has passed and it has not moved to active.",
      expected_delay: Boolean(expectedReason || repeatJob),
      overdue_ms: overdueMs,
      recovery_hint: "Check worker heartbeat, Redis health, and BullMQ delayed promotion.",
    };
  }

  return {
    delayed_classification: "valid",
    delayed_reason:
      expectedReason ||
      (repeatJob
        ? "Repeatable job waiting for its next scheduled run."
        : "Delayed job has a future due time."),
    expected_delay: Boolean(expectedReason || repeatJob),
    overdue_ms: Math.max(0, overdueMs),
    recovery_hint: "No action required while the due time is in the future.",
  };
}

module.exports = {
  DELAYED_CLEANUP_CANDIDATE_MS,
  DELAYED_OVERDUE_MS,
  EXPECTED_DELAYED_JOBS,
  classifyDelayedJob,
};
