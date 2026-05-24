const QUEUE_PREFIX =
  process.env.QUEUE_PREFIX || process.env.ENV_RESOURCE_PREFIX || "food-rescue";

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mergeJobOptions(base, overrides = {}) {
  return {
    ...base,
    ...overrides,
    backoff: {
      ...(base.backoff || {}),
      ...(overrides.backoff || {}),
    },
    removeOnComplete: {
      ...(base.removeOnComplete || {}),
      ...(overrides.removeOnComplete || {}),
    },
    removeOnFail: {
      ...(base.removeOnFail || {}),
      ...(overrides.removeOnFail || {}),
    },
  };
}

const JOB_OPTION_POLICIES = {
  default: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: numberFromEnv("QUEUE_RETRY_BACKOFF_MS", 2000),
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail: {
      age: 14 * 24 * 60 * 60,
      count: 2000,
    },
  },
  critical: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: numberFromEnv("QUEUE_CRITICAL_RETRY_BACKOFF_MS", 3000),
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 2000,
    },
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
      count: 5000,
    },
  },
  notification: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: numberFromEnv("QUEUE_NOTIFICATION_RETRY_BACKOFF_MS", 2000),
    },
    removeOnComplete: {
      age: 60 * 60,
      count: 500,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
      count: 1000,
    },
  },
  operational: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: numberFromEnv("QUEUE_OPERATIONAL_RETRY_BACKOFF_MS", 5000),
    },
    removeOnComplete: {
      age: 7 * 24 * 60 * 60,
      count: 100,
    },
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
      count: 500,
    },
  },
  deadLetter: {
    attempts: 1,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 30 * 24 * 60 * 60,
      count: 10000,
    },
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
      count: 10000,
    },
  },
};

function jobOptions(policy = "default", overrides = {}) {
  const base = JOB_OPTION_POLICIES[policy] || JOB_OPTION_POLICIES.default;
  return mergeJobOptions(base, overrides);
}

function queueOptions(connection, overrides = {}) {
  return {
    connection,
    prefix: QUEUE_PREFIX,
    ...overrides,
    defaultJobOptions: jobOptions("default", overrides.defaultJobOptions || {}),
  };
}

const DEFAULT_WORKER_OPTIONS = {
  concurrency: numberFromEnv("QUEUE_WORKER_CONCURRENCY", 5),
  lockDuration: numberFromEnv("QUEUE_LOCK_DURATION_MS", 120000),
  stalledInterval: numberFromEnv("QUEUE_STALLED_INTERVAL_MS", 30000),
  maxStalledCount: numberFromEnv("QUEUE_MAX_STALLED_COUNT", 2),
  drainDelay: numberFromEnv("QUEUE_DRAIN_DELAY_SECONDS", 5),
  runRetryDelay: numberFromEnv("QUEUE_RUN_RETRY_DELAY_MS", 15000),
};

function workerOptions(connection, overrides = {}) {
  const {
    attempts,
    backoff,
    removeOnComplete,
    removeOnFail,
    ...workerOverrides
  } = overrides;

  return {
    connection,
    prefix: QUEUE_PREFIX,
    ...DEFAULT_WORKER_OPTIONS,
    ...workerOverrides,
  };
}

module.exports = {
  JOB_OPTION_POLICIES,
  QUEUE_PREFIX,
  jobOptions,
  queueOptions,
  workerOptions,
};
