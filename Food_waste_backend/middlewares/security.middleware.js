const compression = require("compression");
const helmet = require("helmet");
const hpp = require("hpp");
const mongoSanitize = require("express-mongo-sanitize");
const logger = require("../shared/utils/logger");

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function parseOrigins(value) {
  if (!value) return [];

  return value
    .split(",")
    .map((origin) => {
      const normalized = origin.trim().replace(/\/+$/, "");

      try {
        return new URL(normalized).origin;
      } catch {
        return normalized;
      }
    })
    .filter(Boolean)
    .filter((origin) => origin !== "*");
}

function getAllowedOrigins() {
  const configuredOrigins = [
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.FRONTEND_ORIGINS),
  ];

  if (isProduction()) {
    return [...new Set(configuredOrigins)];
  }

  return [...new Set([...configuredOrigins, ...LOCAL_DEVELOPMENT_ORIGINS])];
}

function assertAllowedOrigin(origin, callback) {
  if (!origin) {
    return callback(null, true);
  }

  if (getAllowedOrigins().includes(origin.replace(/\/+$/, ""))) {
    return callback(null, true);
  }

  return callback(new Error("Origin not allowed by CORS"));
}

function buildCorsOptions() {
  return {
    origin: assertAllowedOrigin,
    credentials: true,
    exposedHeaders: [
      "X-Notification-Limit",
      "X-Has-More",
      "X-Next-Cursor",
    ],
    optionsSuccessStatus: 204,
  };
}

function buildSocketCorsOptions() {
  return {
    origin: assertAllowedOrigin,
    credentials: true,
  };
}

function buildHelmetMiddleware() {
  const connectSrc = ["'self'", ...getAllowedOrigins()];

  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "connect-src": connectSrc,
        "frame-ancestors": ["'none'"],
        "img-src": ["'self'", "data:", "https:"],
        "style-src": ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: { action: "deny" },
    hsts: isProduction()
      ? { maxAge: 15552000, includeSubDomains: true, preload: false }
      : false,
    noSniff: true,
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
    referrerPolicy: { policy: "no-referrer" },
    xXssProtection: true,
  });
}

function buildCompressionMiddleware() {
  return compression({
    filter(req, res) {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
    threshold: 1024,
  });
}

function buildHppMiddleware() {
  return hpp({
    whitelist: [
      "ids",
      "listing_ids",
      "reservation_ids",
      "statuses",
    ],
  });
}

function sanitizeObjectInPlace(target) {
  if (!target || typeof target !== "object") return;
  mongoSanitize.sanitize(target, { replaceWith: "_" });
}

function sanitizeQueryAndParams(req, res, next) {
  try {
    sanitizeObjectInPlace(req.query);
    sanitizeObjectInPlace(req.params);
  } catch (err) {
    logger.security("Request query sanitization failed", {
      err,
      path: req.originalUrl,
      method: req.method,
    });
  }

  next();
}

module.exports = {
  buildCompressionMiddleware,
  buildCorsOptions,
  buildHelmetMiddleware,
  buildHppMiddleware,
  buildSocketCorsOptions,
  getAllowedOrigins,
  sanitizeQueryAndParams,
};
