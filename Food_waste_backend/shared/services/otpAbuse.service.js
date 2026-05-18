const crypto = require("crypto");
const store = require("./rateLimitStore.service");
const logger = require("../utils/logger");
const { normalizePhoneNumber } = require("../../utils/phone");

const SEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_MS || 45 * 1000);
const SEND_WINDOW_MS = 15 * 60 * 1000;
const SEND_PHONE_LIMIT = 3;
const SEND_IP_LIMIT = 15;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_PHONE_LIMIT = 5;
const VERIFY_IP_LIMIT = 30;
const LOCKOUT_STEPS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function key(scope, value) {
  return `otp:${scope}:${hash(value)}`;
}

function retryAfterSeconds(ms) {
  return Math.max(1, Math.ceil(Number(ms || 0) / 1000));
}

function createOtpError(message, statusCode, code, retryAfterMs = 0) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.retryAfter = retryAfterSeconds(retryAfterMs);
  return error;
}

function getFingerprint(req) {
  return req?.headers?.["x-device-id"] || req?.headers?.["x-client-id"] || req?.headers?.["user-agent"] || "unknown-device";
}

function normalizeContext({ phone, ip, deviceId }) {
  const normalizedPhone = normalizePhoneNumber(phone);
  return {
    phone: normalizedPhone,
    ip: ip || "unknown-ip",
    deviceId: deviceId || "unknown-device",
  };
}

async function assertNotLocked(context) {
  const locks = [
    { scope: "lock:phone", value: context.phone },
    { scope: "lock:ip", value: context.ip },
  ];

  for (const lock of locks) {
    const current = await store.get(key(lock.scope, lock.value));
    if (current.value) {
      throw createOtpError(
        "Too many OTP attempts. Please wait before trying again.",
        429,
        "OTP_LOCKED",
        current.ttlMs
      );
    }
  }
}

async function assertCanSendOtp({ phone, ip, deviceId }) {
  const context = normalizeContext({ phone, ip, deviceId });
  if (!context.phone) return;

  await assertNotLocked(context);

  const cooldown = await store.get(key("send:cooldown", context.phone));
  if (cooldown.value) {
    throw createOtpError(
      "Please wait before requesting another OTP.",
      429,
      "OTP_RESEND_COOLDOWN",
      cooldown.ttlMs
    );
  }
}

async function recordOtpSend({ phone, ip, deviceId }) {
  const context = normalizeContext({ phone, ip, deviceId });
  if (!context.phone) return;

  await store.set(key("send:cooldown", context.phone), "1", SEND_COOLDOWN_MS);

  const checks = [
    {
      scope: "send:phone",
      value: context.phone,
      limit: SEND_PHONE_LIMIT,
      lockScope: "lock:phone",
    },
    {
      scope: "send:ip",
      value: context.ip,
      limit: SEND_IP_LIMIT,
      lockScope: "lock:ip",
    },
    {
      scope: "send:device",
      value: context.deviceId,
      limit: SEND_IP_LIMIT,
      lockScope: null,
    },
  ];

  for (const check of checks) {
    const result = await store.increment(key(check.scope, check.value), SEND_WINDOW_MS);
    if (result.count > check.limit && check.lockScope) {
      await store.set(key(check.lockScope, check.value), "send-limit", 5 * 60 * 1000);
      logger.warn("OTP send abuse lock applied", {
        scope: check.scope,
        ip: context.ip,
        limit: check.limit,
        resetMs: result.resetMs,
      });
    }
  }
}

async function assertCanVerifyOtp({ phone, ip, deviceId }) {
  const context = normalizeContext({ phone, ip, deviceId });
  if (!context.phone) return;

  await assertNotLocked(context);
}

async function getLockoutMs(context) {
  const escalationKey = key("lock:escalation", context.phone);
  const current = await store.increment(escalationKey, 24 * 60 * 60 * 1000);
  const index = Math.min(current.count - 1, LOCKOUT_STEPS_MS.length - 1);
  return LOCKOUT_STEPS_MS[index];
}

async function recordOtpVerifyFailure({ phone, ip, deviceId, reason }) {
  const context = normalizeContext({ phone, ip, deviceId });
  if (!context.phone) return;

  const checks = [
    {
      scope: "verify:phone",
      value: context.phone,
      limit: VERIFY_PHONE_LIMIT,
      lockScope: "lock:phone",
    },
    {
      scope: "verify:ip",
      value: context.ip,
      limit: VERIFY_IP_LIMIT,
      lockScope: "lock:ip",
    },
    {
      scope: "verify:device",
      value: context.deviceId,
      limit: VERIFY_IP_LIMIT,
      lockScope: null,
    },
  ];

  for (const check of checks) {
    const result = await store.increment(key(check.scope, check.value), VERIFY_WINDOW_MS);
    if (result.count >= check.limit && check.lockScope) {
      const lockoutMs = await getLockoutMs(context);
      await store.set(key(check.lockScope, check.value), reason || "verify-failed", lockoutMs);
      logger.warn("OTP verification lock applied", {
        scope: check.scope,
        ip: context.ip,
        limit: check.limit,
        lockoutMs,
      });
    }
  }

  logger.warn("OTP verification failed", {
    ip: context.ip,
    reason,
  });
}

async function recordOtpVerifySuccess({ phone, ip, deviceId }) {
  const context = normalizeContext({ phone, ip, deviceId });
  if (!context.phone) return;

  await Promise.all([
    store.del(key("verify:phone", context.phone)),
    store.del(key("verify:ip", context.ip)),
    store.del(key("verify:device", context.deviceId)),
    store.del(key("lock:phone", context.phone)),
    store.del(key("send:cooldown", context.phone)),
  ]);

  logger.info("OTP verified successfully", {
    ip: context.ip,
  });
}

module.exports = {
  assertCanSendOtp,
  assertCanVerifyOtp,
  getFingerprint,
  recordOtpSend,
  recordOtpVerifyFailure,
  recordOtpVerifySuccess,
};
