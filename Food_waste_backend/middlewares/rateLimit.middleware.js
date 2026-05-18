const crypto = require("crypto");
const logger = require("../shared/utils/logger");
const store = require("../shared/services/rateLimitStore.service");
const {
  recordAlert,
  recordOperationalEvent,
} = require("../shared/services/observability.service");
const { normalizePhoneNumber } = require("../utils/phone");

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sanitizeKeyPart(value) {
  return hash(value).slice(0, 32);
}

function getClientIp(req) {
  return (
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getDeviceId(req) {
  return (
    req.headers["x-device-id"] ||
    req.headers["x-client-id"] ||
    req.headers["user-agent"] ||
    "unknown-device"
  );
}

function getPhone(req) {
  return normalizePhoneNumber(req.body?.phone) || "unknown-phone";
}

function getUserId(req) {
  return req.user?.id || "anonymous";
}

function getRouteKey(req) {
  return `${req.method}:${req.baseUrl || ""}${req.route?.path || req.path}`;
}

function seconds(ms) {
  return Math.max(1, Math.ceil(ms / 1000));
}

function rateLimitResponse(req, res, violation) {
  const retryAfter = seconds(violation.resetMs);
  res.set("Retry-After", String(retryAfter));
  return res.status(429).json({
    success: false,
    message: violation.message || "Too many requests. Please try again later.",
    error: violation.message || "Too many requests. Please try again later.",
    code: violation.code || "RATE_LIMITED",
    retryAfter,
    data: null,
  });
}

function buildRuleKey(req, rule) {
  const identity = rule.keyGenerator(req);
  return `rl:${rule.name}:${sanitizeKeyPart(identity)}`;
}

function createRateLimiter({ name, rules, message, code }) {
  return async (req, res, next) => {
    try {
      for (const rule of rules) {
        const key = buildRuleKey(req, rule);
        const windowMs = rule.windowMs;
        const result = await store.increment(key, windowMs);

        if (result.count > rule.limit) {
          const violation = {
            name: rule.name,
            limit: rule.limit,
            count: result.count,
            resetMs: result.resetMs,
            code: rule.code || code,
            message: rule.message || message,
          };

          const event = {
            limiter: name,
            rule: rule.name,
            ip: getClientIp(req),
            userId: req.user?.id,
            route: getRouteKey(req),
            limit: rule.limit,
            count: result.count,
            resetMs: result.resetMs,
            backend: result.backend,
          };

          logger.security("Rate limit violation", event);
          void recordOperationalEvent({
            category: "security",
            severity: "warning",
            eventName: "rate_limit_violation",
            metadata: event,
          });
          if (name.includes("otp") || result.count >= rule.limit * 2) {
            void recordAlert({
              alertKey: `security:${name}:${rule.name}`,
              category: "security",
              severity: "warning",
              message: `Rate limit spike on ${name}`,
              metadata: event,
            });
          }

          return rateLimitResponse(req, res, violation);
        }
      }

      return next();
    } catch (err) {
      logger.error("Rate limiter failed open", {
        err,
        limiter: name,
        route: getRouteKey(req),
      });
      return next();
    }
  };
}

function byIp(req) {
  return `ip:${getClientIp(req)}`;
}

function byDevice(req) {
  return `device:${getDeviceId(req)}`;
}

function byUser(req) {
  return `user:${getUserId(req)}`;
}

function byPhone(req) {
  return `phone:${getPhone(req)}`;
}

function byUserOrIp(req) {
  return req.user?.id ? byUser(req) : byIp(req);
}

const globalLimiter = createRateLimiter({
  name: "global",
  message: "Too many requests. Please slow down.",
  rules: [
    { name: "global-ip-minute", limit: 240, windowMs: 60 * 1000, keyGenerator: byIp },
    {
      name: "global-device-minute",
      limit: 300,
      windowMs: 60 * 1000,
      keyGenerator: byDevice,
    },
  ],
});

const authLimiter = createRateLimiter({
  name: "auth",
  message: "Too many authentication requests. Please try again later.",
  rules: [
    { name: "auth-ip-15m", limit: 30, windowMs: 15 * 60 * 1000, keyGenerator: byIp },
    {
      name: "auth-device-15m",
      limit: 30,
      windowMs: 15 * 60 * 1000,
      keyGenerator: byDevice,
    },
  ],
});

const otpSendLimiter = createRateLimiter({
  name: "otp-send",
  message: "Too many OTP requests. Please wait before requesting another code.",
  code: "OTP_SEND_RATE_LIMITED",
  rules: [
    { name: "otp-send-phone-15m", limit: 3, windowMs: 15 * 60 * 1000, keyGenerator: byPhone },
    { name: "otp-send-ip-15m", limit: 15, windowMs: 15 * 60 * 1000, keyGenerator: byIp },
    {
      name: "otp-send-device-15m",
      limit: 10,
      windowMs: 15 * 60 * 1000,
      keyGenerator: byDevice,
    },
  ],
});

const otpVerifyLimiter = createRateLimiter({
  name: "otp-verify",
  message: "Too many OTP verification attempts. Please wait before trying again.",
  code: "OTP_VERIFY_RATE_LIMITED",
  rules: [
    { name: "otp-verify-phone-15m", limit: 8, windowMs: 15 * 60 * 1000, keyGenerator: byPhone },
    { name: "otp-verify-ip-15m", limit: 30, windowMs: 15 * 60 * 1000, keyGenerator: byIp },
    {
      name: "otp-verify-device-15m",
      limit: 20,
      windowMs: 15 * 60 * 1000,
      keyGenerator: byDevice,
    },
  ],
});

const reservationCreateLimiter = createRateLimiter({
  name: "reservation-create",
  message: "Too many reservation attempts. Please wait before trying again.",
  rules: [
    { name: "reservation-user-10m", limit: 8, windowMs: 10 * 60 * 1000, keyGenerator: byUserOrIp },
    { name: "reservation-ip-10m", limit: 30, windowMs: 10 * 60 * 1000, keyGenerator: byIp },
  ],
});

const reportLimiter = createRateLimiter({
  name: "provider-report",
  message: "Too many report submissions. Please wait before reporting again.",
  rules: [
    { name: "report-user-hour", limit: 4, windowMs: 60 * 60 * 1000, keyGenerator: byUserOrIp },
    { name: "report-ip-hour", limit: 20, windowMs: 60 * 60 * 1000, keyGenerator: byIp },
  ],
});

const ngoBulkReserveLimiter = createRateLimiter({
  name: "ngo-bulk-reserve",
  message: "Too many bulk reserve attempts. Please wait before trying again.",
  rules: [
    { name: "ngo-bulk-user-10m", limit: 6, windowMs: 10 * 60 * 1000, keyGenerator: byUserOrIp },
    { name: "ngo-bulk-ip-10m", limit: 20, windowMs: 10 * 60 * 1000, keyGenerator: byIp },
  ],
});

const ngoRequestLimiter = createRateLimiter({
  name: "ngo-request",
  message: "Too many NGO request actions. Please wait before trying again.",
  rules: [
    { name: "ngo-request-user-10m", limit: 12, windowMs: 10 * 60 * 1000, keyGenerator: byUserOrIp },
    { name: "ngo-request-ip-10m", limit: 40, windowMs: 10 * 60 * 1000, keyGenerator: byIp },
  ],
});

const volunteerActionLimiter = createRateLimiter({
  name: "volunteer-action",
  message: "Too many volunteer actions. Please wait before trying again.",
  rules: [
    { name: "volunteer-user-10m", limit: 15, windowMs: 10 * 60 * 1000, keyGenerator: byUserOrIp },
    { name: "volunteer-ip-10m", limit: 40, windowMs: 10 * 60 * 1000, keyGenerator: byIp },
  ],
});

const listingCreateLimiter = createRateLimiter({
  name: "listing-create",
  message: "Too many listing changes. Please wait before trying again.",
  rules: [
    { name: "listing-user-hour", limit: 12, windowMs: 60 * 60 * 1000, keyGenerator: byUserOrIp },
    { name: "listing-ip-hour", limit: 40, windowMs: 60 * 60 * 1000, keyGenerator: byIp },
  ],
});

const registrationLimiter = createRateLimiter({
  name: "registration",
  message: "Too many registration attempts. Please try again later.",
  rules: [
    { name: "registration-user-hour", limit: 6, windowMs: 60 * 60 * 1000, keyGenerator: byUserOrIp },
    { name: "registration-ip-hour", limit: 20, windowMs: 60 * 60 * 1000, keyGenerator: byIp },
  ],
});

const adminActionLimiter = createRateLimiter({
  name: "admin-action",
  message: "Too many admin actions. Please slow down.",
  rules: [
    { name: "admin-user-10m", limit: 60, windowMs: 10 * 60 * 1000, keyGenerator: byUserOrIp },
  ],
});

module.exports = {
  adminActionLimiter,
  authLimiter,
  createRateLimiter,
  getClientIp,
  getDeviceId,
  globalLimiter,
  listingCreateLimiter,
  ngoBulkReserveLimiter,
  ngoRequestLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  registrationLimiter,
  reportLimiter,
  reservationCreateLimiter,
  volunteerActionLimiter,
};
