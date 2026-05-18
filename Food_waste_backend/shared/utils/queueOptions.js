const DEFAULT_QUEUE_OPTIONS = {
  prefix: process.env.QUEUE_PREFIX || process.env.ENV_RESOURCE_PREFIX || "food-rescue",
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
      count: 1000,
    },
  },
};

function queueOptions(connection, overrides = {}) {
  return {
    connection,
    ...DEFAULT_QUEUE_OPTIONS,
    ...overrides,
    defaultJobOptions: {
      ...DEFAULT_QUEUE_OPTIONS.defaultJobOptions,
      ...(overrides.defaultJobOptions || {}),
    },
  };
}

const DEFAULT_WORKER_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 1000,
  },
};

function workerOptions(connection, overrides = {}) {
  return {
    connection,
    prefix: process.env.QUEUE_PREFIX || process.env.ENV_RESOURCE_PREFIX || "food-rescue",
    concurrency: Number(process.env.QUEUE_WORKER_CONCURRENCY || 5),
    ...DEFAULT_WORKER_OPTIONS,
    ...overrides,
  };
}

module.exports = {
  queueOptions,
  workerOptions,
};
