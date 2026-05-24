const logger = require("./logger");

const registeredQueues = new Map();
const registeredWorkers = new Map();
const registeredTimers = new Map();

function registerQueue(queue) {
  if (!queue?.name) return queue;

  if (!registeredQueues.has(queue.name)) {
    registeredQueues.set(queue.name, queue);
    queue.on("error", (err) => {
      logger.error("Queue connection error", {
        queue: queue.name,
        err,
      });
    });
  }

  return queue;
}

function registerWorker(workerName, worker) {
  if (!workerName || !worker) return worker;
  registeredWorkers.set(workerName, worker);
  return worker;
}

function registerManagedInterval(name, fn, intervalMs, options = {}) {
  if (!name || typeof fn !== "function") {
    throw new Error("Managed interval requires a name and callback");
  }

  if (registeredTimers.has(name)) {
    clearInterval(registeredTimers.get(name));
  }

  const run = () => {
    Promise.resolve()
      .then(fn)
      .catch((err) => {
        logger.error("Managed interval failed", { name, err });
      });
  };

  if (options.runImmediately) {
    run();
  }

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  registeredTimers.set(name, timer);
  return timer;
}

function clearManagedIntervals() {
  for (const timer of registeredTimers.values()) {
    clearInterval(timer);
  }
  registeredTimers.clear();
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

async function closeWorker(workerName, worker, timeoutMs) {
  try {
    logger.info("Closing queue worker", { workerName });
    await worker.pause(false);
    await withTimeout(worker.close(false), timeoutMs, `Closing worker ${workerName}`);
    logger.info("Queue worker closed", { workerName });
  } catch (err) {
    logger.error("Graceful worker close failed; forcing close", {
      workerName,
      err,
    });
    try {
      await worker.close(true);
    } catch (forceErr) {
      logger.error("Forced worker close failed", {
        workerName,
        err: forceErr,
      });
    }
  }
}

async function closeQueue(queueName, queue, timeoutMs) {
  try {
    logger.info("Closing queue producer", { queueName });
    await withTimeout(queue.close(), timeoutMs, `Closing queue ${queueName}`);
    logger.info("Queue producer closed", { queueName });
  } catch (err) {
    logger.error("Queue producer close failed", { queueName, err });
  }
}

async function closeQueueRuntime(options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.QUEUE_SHUTDOWN_TIMEOUT_MS || 30000);

  clearManagedIntervals();

  for (const [workerName, worker] of registeredWorkers.entries()) {
    await closeWorker(workerName, worker, timeoutMs);
  }

  for (const [queueName, queue] of registeredQueues.entries()) {
    await closeQueue(queueName, queue, timeoutMs);
  }

  registeredWorkers.clear();
  registeredQueues.clear();
}

function getQueueRuntimeSnapshot() {
  return {
    queues: Array.from(registeredQueues.keys()),
    workers: Array.from(registeredWorkers.keys()),
    timers: Array.from(registeredTimers.keys()),
  };
}

module.exports = {
  clearManagedIntervals,
  closeQueueRuntime,
  getQueueRuntimeSnapshot,
  registerManagedInterval,
  registerQueue,
  registerWorker,
};
