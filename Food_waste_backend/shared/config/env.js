const fs = require("fs");
const path = require("path");
const dotenvSafe = require("dotenv-safe");
const { z } = require("zod");
const logger = require("../utils/logger");

const APP_ENVIRONMENTS = new Set([
  "local",
  "development",
  "staging",
  "production",
]);

const BASE_REQUIRED_ENV = [
  "APP_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "FRONTEND_URL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
  "CASHFREE_APP_ID",
  "CASHFREE_SECRET_KEY",
  "CASHFREE_ENV",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const PRODUCTION_REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CASHFREE_WEBHOOK_SECRET",
  "METRICS_TOKEN",
];

let validatedEnv;
let dotenvSafeLoaded = false;

const optionalString = z.preprocess(
  (value) => {
    const normalized = String(value || "").trim();
    return normalized || undefined;
  },
  z.string().optional()
);

const requiredString = (name) =>
  z.string({
    required_error: `${name} is required`,
    invalid_type_error: `${name} is required`,
  }).trim().min(1, `${name} is required`);

const urlString = (name, protocols) =>
  requiredString(name)
    .url(`${name} must be a valid URL`)
    .refine((value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, `${name} must use one of: ${protocols.join(", ")}`);

const optionalUrlString = (name, protocols) =>
  optionalString.refine((value) => {
    if (!value) return true;
    try {
      return protocols.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, `${name} must be a valid URL using one of: ${protocols.join(", ")}`);

const numberFromEnv = (name, { min, max, fallback }) =>
  z.preprocess(
    (value) => {
      const raw = String(value || fallback || "").trim();
      return raw ? Number(raw) : undefined;
    },
    z.number({
      invalid_type_error: `${name} must be a number`,
      required_error: `${name} is required`,
    }).min(min, `${name} must be at least ${min}`).max(max, `${name} must be at most ${max}`)
  );

const envSchema = z.object({
  APP_ENV: requiredString("APP_ENV")
    .transform((value) =>
      value.toLowerCase() === "prod" ? "production" : value.toLowerCase()
    )
    .pipe(z.enum(Array.from(APP_ENVIRONMENTS))),
  NODE_ENV: z
    .preprocess(
      (value) => String(value || "development").trim().toLowerCase(),
      z.enum(["development", "test", "production"])
    )
    .default("development"),
  PORT: z.preprocess(
    (value) => {
      const raw = String(value || "5000").trim();
      return raw ? Number(raw) : 5000;
    },
    z.number().int().min(1).max(65535)
  ),
  DATABASE_URL: urlString("DATABASE_URL", ["postgres:", "postgresql:"]),
  REDIS_URL: urlString("REDIS_URL", ["redis:", "rediss:"]),
  JWT_SECRET: requiredString("JWT_SECRET"),
  FRONTEND_URL: urlString("FRONTEND_URL", ["http:", "https:"]),
  FRONTEND_ORIGINS: optionalString,
  TWILIO_ACCOUNT_SID: requiredString("TWILIO_ACCOUNT_SID"),
  TWILIO_AUTH_TOKEN: requiredString("TWILIO_AUTH_TOKEN"),
  TWILIO_VERIFY_SERVICE_SID: requiredString("TWILIO_VERIFY_SERVICE_SID"),
  CASHFREE_APP_ID: requiredString("CASHFREE_APP_ID"),
  CASHFREE_SECRET_KEY: requiredString("CASHFREE_SECRET_KEY"),
  CASHFREE_ENV: requiredString("CASHFREE_ENV").transform((value) => value.toLowerCase()),
  CASHFREE_WEBHOOK_SECRET: optionalString,
  SUPABASE_URL: optionalUrlString("SUPABASE_URL", ["https:"]),
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  CLOUDINARY_CLOUD_NAME: requiredString("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: requiredString("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: requiredString("CLOUDINARY_API_SECRET"),
  ENV_RESOURCE_PREFIX: optionalString,
  ALLOW_PRODUCTION_CREDENTIALS_IN_NON_PROD: optionalString,
  COOKIE_SECURE: optionalString,
  COOKIE_SAME_SITE: optionalString,
  JSON_BODY_LIMIT: optionalString,
  URLENCODED_BODY_LIMIT: optionalString,
  METRICS_TOKEN: optionalString,
  TRUST_PROXY_HOPS: z.preprocess(
    (value) => {
      const raw = String(value || "1").trim();
      return raw ? Number(raw) : 1;
    },
    z.number().int().min(0).max(5)
  ),
  SOCKET_PING_INTERVAL_MS: numberFromEnv("SOCKET_PING_INTERVAL_MS", {
    min: 5000,
    max: 60000,
    fallback: "25000",
  }),
  SOCKET_PING_TIMEOUT_MS: numberFromEnv("SOCKET_PING_TIMEOUT_MS", {
    min: 5000,
    max: 60000,
    fallback: "20000",
  }),
  QUEUE_WORKER_CONCURRENCY: numberFromEnv("QUEUE_WORKER_CONCURRENCY", {
    min: 1,
    max: 50,
    fallback: "5",
  }),
  MAX_UPLOAD_BYTES: numberFromEnv("MAX_UPLOAD_BYTES", {
    min: 1024,
    max: 10 * 1024 * 1024,
    fallback: String(5 * 1024 * 1024),
  }),
});

function normalizeNodeEnv() {
  const current = process.env.NODE_ENV;
  if (!current || current === "TEST") {
    process.env.NODE_ENV = "development";
  }
}

function normalizeAppEnvDefault() {
  if (String(process.env.APP_ENV || "").trim()) return;

  process.env.APP_ENV =
    process.env.NODE_ENV === "production" ? "production" : "development";
}

function getEnvPath() {
  return path.resolve(process.cwd(), process.env.ENV_FILE || ".env");
}

function seedAppEnvDefaultForDotenvSafe() {
  if (String(process.env.APP_ENV || "").trim()) return;
  if (fs.existsSync(getEnvPath())) return;

  process.env.APP_ENV =
    process.env.NODE_ENV === "production" ? "production" : "development";
}

function isProductionLike(appEnv = process.env.APP_ENV) {
  return appEnv === "production";
}

function isStagingOrProduction(appEnv = process.env.APP_ENV) {
  return appEnv === "staging" || appEnv === "production";
}

function parseOrigins(value) {
  if (!value) return [];

  return String(value)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map((origin) => {
      if (origin === "*") return origin;
      try {
        return new URL(origin).origin;
      } catch {
        throw new Error(`${origin} is not a valid CORS origin`);
      }
    });
}

function assertHttpsUrl(name, value, ctx) {
  if (!value) return;

  try {
    if (new URL(value).protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: `${name} must use HTTPS in production`,
      });
    }
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [name],
      message: `${name} must be a valid URL`,
    });
  }
}

function addMissingIssue(ctx, key) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [key],
    message: `${key} is required`,
  });
}

function validateCrossFieldRules(env, ctx) {
  const production = isProductionLike(env.APP_ENV);
  const stagingOrProduction = isStagingOrProduction(env.APP_ENV);
  let frontendOrigins = [];
  try {
    frontendOrigins = [
      ...parseOrigins(env.FRONTEND_URL),
      ...parseOrigins(env.FRONTEND_ORIGINS),
    ];
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FRONTEND_ORIGINS"],
      message: err.message,
    });
  }
  const uniqueOrigins = [...new Set(frontendOrigins)];

  if (production && env.NODE_ENV !== "production") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["NODE_ENV"],
      message: "APP_ENV=production requires NODE_ENV=production",
    });
  }

  if (!production && env.NODE_ENV === "production") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["APP_ENV"],
      message: "NODE_ENV=production requires APP_ENV=production",
    });
  }

  if (stagingOrProduction && !env.ENV_RESOURCE_PREFIX) {
    addMissingIssue(ctx, "ENV_RESOURCE_PREFIX");
  }

  if (production) {
    for (const key of PRODUCTION_REQUIRED_ENV) {
      if (!String(env[key] || "").trim()) addMissingIssue(ctx, key);
    }

    assertHttpsUrl("FRONTEND_URL", env.FRONTEND_URL, ctx);
    assertHttpsUrl("SUPABASE_URL", env.SUPABASE_URL, ctx);

    if (!uniqueOrigins.length || uniqueOrigins.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FRONTEND_ORIGINS"],
        message: "Production CORS origins must be explicit and cannot include *",
      });
    }

    for (const origin of uniqueOrigins) {
      if (origin !== "*" && new URL(origin).protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["FRONTEND_ORIGINS"],
          message: `Production CORS origin must use HTTPS: ${origin}`,
        });
      }
    }
  }

  if (env.TWILIO_ACCOUNT_SID && !env.TWILIO_ACCOUNT_SID.startsWith("AC")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TWILIO_ACCOUNT_SID"],
      message: "TWILIO_ACCOUNT_SID must be a valid Twilio Account SID",
    });
  }

  if (
    env.TWILIO_VERIFY_SERVICE_SID &&
    !env.TWILIO_VERIFY_SERVICE_SID.startsWith("VA")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TWILIO_VERIFY_SERVICE_SID"],
      message: "TWILIO_VERIFY_SERVICE_SID must be a valid Twilio Verify Service SID",
    });
  }

  const secretMinimum = production ? 32 : 12;
  if (env.JWT_SECRET.length < secretMinimum) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: `JWT_SECRET must be at least ${secretMinimum} characters`,
    });
  }

  const placeholderSecrets = new Set(["secret", "supersecret", "supersecretkey", "changeme"]);
  if (production && placeholderSecrets.has(env.JWT_SECRET.toLowerCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must not use a development placeholder",
    });
  }

  if (!["sandbox", "test", "production", "prod"].includes(env.CASHFREE_ENV)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CASHFREE_ENV"],
      message: "CASHFREE_ENV must be sandbox, test, or production",
    });
  }

  const allowProductionCredentials =
    env.ALLOW_PRODUCTION_CREDENTIALS_IN_NON_PROD === "true";
  const wantsProductionCashfree =
    env.CASHFREE_ENV === "production" ||
    env.CASHFREE_ENV === "prod" ||
    !env.CASHFREE_APP_ID.startsWith("TEST");

  if (!production && wantsProductionCashfree && !allowProductionCredentials) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CASHFREE_APP_ID"],
      message: "Production Cashfree credentials are blocked outside APP_ENV=production",
    });
  }

  if (production && ["sandbox", "test"].includes(env.CASHFREE_ENV)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CASHFREE_ENV"],
      message: "Production deployments must use CASHFREE_ENV=production",
    });
  }

  if (
    env.COOKIE_SAME_SITE &&
    !["lax", "strict", "none"].includes(env.COOKIE_SAME_SITE.toLowerCase())
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["COOKIE_SAME_SITE"],
      message: "COOKIE_SAME_SITE must be lax, strict, or none",
    });
  }
}

function formatZodError(err) {
  return err.issues
    .map((issue) => {
      const key = issue.path.length ? issue.path.join(".") : "environment";
      return `${key}: ${issue.message}`;
    })
    .join("; ");
}

function loadDotenvSafe() {
  if (dotenvSafeLoaded) return;

  const envPath = getEnvPath();
  const examplePath = path.resolve(__dirname, "../../env.example");

  dotenvSafe.config({
    allowEmptyValues: false,
    example: examplePath,
    path: envPath,
    quiet: true,
  });

  dotenvSafeLoaded = true;
}

function applyNormalizedEnv(env) {
  const frontendOrigins = [
    ...parseOrigins(env.FRONTEND_URL),
    ...parseOrigins(env.FRONTEND_ORIGINS),
  ];

  process.env.APP_ENV = env.APP_ENV;
  process.env.NODE_ENV = env.NODE_ENV;
  process.env.PORT = String(env.PORT);
  process.env.FRONTEND_URL = parseOrigins(env.FRONTEND_URL)[0];
  process.env.FRONTEND_ORIGINS = [...new Set(frontendOrigins)].join(",");
  process.env.CASHFREE_ENV = env.CASHFREE_ENV === "prod" ? "production" : env.CASHFREE_ENV;
  process.env.TRUST_PROXY_HOPS = String(env.TRUST_PROXY_HOPS);
  process.env.SOCKET_PING_INTERVAL_MS = String(env.SOCKET_PING_INTERVAL_MS);
  process.env.SOCKET_PING_TIMEOUT_MS = String(env.SOCKET_PING_TIMEOUT_MS);
  process.env.QUEUE_WORKER_CONCURRENCY = String(env.QUEUE_WORKER_CONCURRENCY);
  process.env.MAX_UPLOAD_BYTES = String(env.MAX_UPLOAD_BYTES);

  if (!process.env.JSON_BODY_LIMIT) {
    process.env.JSON_BODY_LIMIT = env.JSON_BODY_LIMIT || "256kb";
  }

  if (!process.env.URLENCODED_BODY_LIMIT) {
    process.env.URLENCODED_BODY_LIMIT = env.URLENCODED_BODY_LIMIT || "64kb";
  }

  if (env.COOKIE_SAME_SITE) {
    process.env.COOKIE_SAME_SITE = env.COOKIE_SAME_SITE.toLowerCase();
  }
}

function validateEnvironment() {
  seedAppEnvDefaultForDotenvSafe();
  loadDotenvSafe();
  normalizeNodeEnv();
  normalizeAppEnvDefault();

  const schema = envSchema.superRefine(validateCrossFieldRules);
  const result = schema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${formatZodError(result.error)}`);
  }

  applyNormalizedEnv(result.data);
  validatedEnv = Object.freeze({ ...result.data });

  logger.info("Environment validated", {
    appEnv: process.env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    corsOrigins: process.env.FRONTEND_ORIGINS,
  });

  return validatedEnv;
}

function getValidatedEnv() {
  return validatedEnv || validateEnvironment();
}

module.exports = {
  APP_ENVIRONMENTS,
  BASE_REQUIRED_ENV,
  PRODUCTION_REQUIRED_ENV,
  getValidatedEnv,
  isProductionLike,
  isStagingOrProduction,
  parseOrigins,
  validateEnvironment,
};
