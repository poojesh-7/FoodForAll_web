const logger = require("../utils/logger");

let redis = null;
try {
  redis = require("../config/redis");
} catch (err) {
  logger.warn("Redis unavailable for rate limiting; using memory fallback", {
    err,
  });
}

const memoryStore = new Map();

function nowMs() {
  return Date.now();
}

function cleanupMemoryKey(key) {
  const entry = memoryStore.get(key);
  if (entry && entry.expiresAt <= nowMs()) {
    memoryStore.delete(key);
    return null;
  }
  return entry || null;
}

function normalizeTtlSeconds(ttlMs) {
  return Math.max(1, Math.ceil(Number(ttlMs || 0) / 1000));
}

async function increment(key, windowMs) {
  const ttlSeconds = normalizeTtlSeconds(windowMs);

  if (redis?.isOpen) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttlSeconds);
    }
    const ttl = await redis.ttl(key);
    return {
      count,
      resetMs: Math.max(0, ttl) * 1000,
      backend: "redis",
    };
  }

  const existing = cleanupMemoryKey(key);
  if (!existing) {
    memoryStore.set(key, {
      count: 1,
      expiresAt: nowMs() + windowMs,
    });
    return { count: 1, resetMs: windowMs, backend: "memory" };
  }

  existing.count += 1;
  return {
    count: existing.count,
    resetMs: Math.max(0, existing.expiresAt - nowMs()),
    backend: "memory",
  };
}

async function get(key) {
  if (redis?.isOpen) {
    const [value, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
    return {
      value,
      ttlMs: Math.max(0, ttl) * 1000,
      backend: "redis",
    };
  }

  const entry = cleanupMemoryKey(key);
  return {
    value: entry?.value ?? entry?.count ?? null,
    ttlMs: entry ? Math.max(0, entry.expiresAt - nowMs()) : 0,
    backend: "memory",
  };
}

async function set(key, value, ttlMs) {
  const ttlSeconds = normalizeTtlSeconds(ttlMs);

  if (redis?.isOpen) {
    await redis.setEx(key, ttlSeconds, String(value));
    return;
  }

  memoryStore.set(key, {
    value: String(value),
    expiresAt: nowMs() + ttlMs,
  });
}

async function del(key) {
  if (redis?.isOpen) {
    await redis.del(key);
    return;
  }

  memoryStore.delete(key);
}

async function getJson(key) {
  const { value, ttlMs } = await get(key);
  if (!value) return { value: null, ttlMs };

  try {
    return { value: JSON.parse(value), ttlMs };
  } catch {
    return { value: null, ttlMs };
  }
}

async function setJson(key, value, ttlMs) {
  await set(key, JSON.stringify(value), ttlMs);
}

module.exports = {
  del,
  get,
  getJson,
  increment,
  set,
  setJson,
};
