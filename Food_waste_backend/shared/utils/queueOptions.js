const DEFAULT_QUEUE_OPTIONS = {
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
    ...DEFAULT_WORKER_OPTIONS,
    ...overrides,
  };
}

module.exports = {
  queueOptions,
  workerOptions,
};
