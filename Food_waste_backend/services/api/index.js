const {
  isProductionLike,
  validateEnvironment,
} = require("../../shared/config/env");
validateEnvironment();
const pool = require("../../shared/config/db");
const redis = require("../../shared/config/redis");
const bullmqConnection = require("../../shared/config/bullmq");
const {
  assertMigrationsCurrent,
} = require("../../shared/config/migrationStatus");
const bullBoardServer = require("../../admin/bullBoard");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const {
  buildCompressionMiddleware,
  buildCorsOptions,
  buildHelmetMiddleware,
  buildHppMiddleware,
  buildSocketCorsOptions,
  sanitizeQueryAndParams,
} = require("../../middlewares/security.middleware");
const {
  errorHandler,
  notFoundHandler,
} = require("../../middlewares/error.middleware");
const { globalLimiter } = require("../../middlewares/rateLimit.middleware");
const { isValidId } = require("../../utils/validation");
const logger = require("../../shared/utils/logger");
const {
  assertBackendArchitecture,
} = require("../../shared/utils/backendArchitectureValidation");
assertBackendArchitecture({ logger });
const {
  closeQueueRuntime,
  getQueueRuntimeSnapshot,
} = require("../../shared/utils/queueRuntime");
const {
  TokenVerificationError,
  extractAccessTokenFromSocketHandshake,
  verifyAccessToken,
} = require("../../utils/token");
const requestContextMiddleware = require("../../middlewares/requestContext.middleware");
const healthRoutes = require("../../routes/health.routes");
const metricsRoutes = require("../../routes/metrics.routes");
const {
  registerProcessErrorHandlers,
} = require("../../shared/services/errorTracking.service");
const {
  ensureUserIdentityConstraints,
} = require("../../shared/services/userIdentityConstraints.service");
const { ensureRestrictionSchema } = require("../../shared/services/restrictionSchema.service");
const {
  ensureReservationInteractionLockSchema,
} = require("../../shared/services/reservationLock.service");
const {
  ensurePaymentHardeningSchema,
} = require("../../shared/services/paymentReconciliation.service");
const {
  ensureObservabilitySchema,
} = require("../../shared/services/observability.service");

const app = express();
const server = http.createServer(app);
const paymentRoutes = require("../../routes/payment.routes");
const corsOptions = buildCorsOptions();
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || "256kb";
const urlencodedBodyLimit = process.env.URLENCODED_BODY_LIMIT || "64kb";

app.disable("x-powered-by");

if (isProductionLike(process.env.APP_ENV)) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
}

const io = new Server(server, {
  cors: buildSocketCorsOptions(),
  pingInterval: Number(process.env.SOCKET_PING_INTERVAL_MS || 25000),
  pingTimeout: Number(process.env.SOCKET_PING_TIMEOUT_MS || 20000),
});
const cookieParser = require("cookie-parser");
const cookie = require("cookie");

app.use(cookieParser());
app.use(buildHelmetMiddleware());
app.use(buildCompressionMiddleware());
app.use(cors(corsOptions));
app.use(buildHppMiddleware());
app.use(sanitizeQueryAndParams);
app.use(requestContextMiddleware);
app.use("/api/v1", globalLimiter);
app.use("/health", healthRoutes);
app.use("/metrics", metricsRoutes);
// require("../../admin/cleanup");

io.use((socket, next) => {
  const socketMeta = {
    socketId: socket.id,
    ip: socket.handshake.address,
  };
  let tokenSource = null;

  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    const tokenResult = extractAccessTokenFromSocketHandshake(
      socket.handshake,
      cookies
    );
    const token = tokenResult.token;
    tokenSource = tokenResult.source;

    if (!token) {
      logger.security("Socket authentication failed", {
        reason: "missing_token",
        ...socketMeta,
      });
      return next(new Error("Unauthorized"));
    }

    const decoded = verifyAccessToken(token);

    if (!decoded?.id || !isValidId(decoded.id)) {
      logger.security("Socket authentication failed", {
        reason: "invalid_user_id",
        tokenSource,
        ...socketMeta,
      });
      return next(new Error("Invalid token"));
    }

    socket.user = decoded;
    socket.data.user = decoded;

    next();
  } catch (err) {
    const reason =
      err instanceof TokenVerificationError ? err.reason : "auth_exception";

    logger.security("Socket authentication failed", {
      reason,
      tokenSource,
      ...socketMeta,
      err,
    });
    next(new Error("Invalid token"));
  }
});

app.use("/api/v1/payments", paymentRoutes);

app.use(express.json({
  limit: jsonBodyLimit,
  strict: true,
  type: ["application/json", "application/*+json"],
}));
app.use(express.urlencoded({
  extended: false,
  limit: urlencodedBodyLimit,
  parameterLimit: 100,
}));
app.set("io", io);

/*
========================
Socket Connections
========================
*/

io.on("connection", (socket) => {
  const userId = socket.user?.id;

  logger.info("Socket connected", { socketId: socket.id, userId });

  if (!userId) {
    socket.disconnect(true);
    return;
  }

  socket.join(`user:${userId}`);

  socket.on("join", (requestedUserId, ack) => {
    if (String(requestedUserId) !== String(userId)) {
      logger.warn("Unauthorized socket room join blocked", {
        socketId: socket.id,
        userId,
        requestedUserId,
      });
      if (typeof ack === "function") {
        ack({ success: false, message: "Unauthorized room" });
      }
      socket.disconnect(true);
      return;
    }

    socket.join(`user:${userId}`);
    if (typeof ack === "function") {
      ack({ success: true });
    }
  });

  socket.on("disconnect", () => {
    socket.removeAllListeners();
    logger.info("Socket disconnected", { socketId: socket.id, userId });
  });
});

/*
========================
Redis Socket Bridge
========================
*/

let socketBridgeSubscriber;

async function startSocketBridge() {
  const subscriber = redis.duplicate();
  socketBridgeSubscriber = subscriber;

  await subscriber.connect();

  await subscriber.subscribe("socket_events", (message) => {
    try {
      const payload = JSON.parse(message);

      if (payload.room) {
        io.to(payload.room).emit(payload.event, payload.data);
      } else {
        io.emit(payload.event, payload.data);
      }
    } catch (err) {
      logger.error("Socket event bridge payload failed", { err });
    }
  });

  logger.info("Socket event bridge running");
}

startSocketBridge().catch((err) => {
  logger.error("Socket event bridge failed to start", { err });
});

/*
========================
Start Server
========================
*/
const adminRoutes = require("../../admin/admins.routes");
app.use("/api/v1/admin", adminRoutes);

const authRoutes = require("../../routes/auth.routes");
const userRoutes = require("../../routes/user.routes");
const foodRoutes = require("../../routes/food.routes");
const reservationRoutes = require("../../routes/reservation.routes");
const ngoRoutes = require("../../routes/ngo.routes");
const providerModerationRoutes = require("../../routes/providerModeration.routes");
const volunteerRoutes = require("../../routes/volunteer.routes");
const ratingRoutes = require("../../routes/rating.routes");
const impactRoutes = require("../../routes/impact.routes");
const notificationRoutes = require("../../routes/notification.routes");
const authMiddleware = require("../../middlewares/auth.middleware");
const requireAdmin = require("../../middlewares/admin.middleware");

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/food", foodRoutes);
app.use("/api/v1/reservations", reservationRoutes);
app.use("/api/v1/ngos", ngoRoutes);
app.use("/api/v1/provider/moderation-cases", providerModerationRoutes);
app.use("/api/v1/volunteers", volunteerRoutes);
app.use("/api/v1/ratings", ratingRoutes);
app.use("/api/v1/impact", impactRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/admin/queues", authMiddleware, requireAdmin, bullBoardServer.getRouter());

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

registerProcessErrorHandlers("api");

let shuttingDown = false;

function withShutdownTimeout(promise, label) {
  const timeoutMs = Number(process.env.API_SHUTDOWN_TIMEOUT_MS || 30000);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function closeHttpServer() {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function closeSocketServer() {
  return new Promise((resolve) => {
    io.close(() => resolve());
  });
}

async function closeRedisClients() {
  if (socketBridgeSubscriber?.isOpen) {
    await socketBridgeSubscriber.quit();
  }

  if (redis.isOpen) {
    await redis.quit();
  }

  if (bullmqConnection.status !== "end") {
    await bullmqConnection.quit();
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn("API server shutting down", {
    signal,
    runtime: getQueueRuntimeSnapshot(),
  });

  try {
    await withShutdownTimeout(closeHttpServer(), "HTTP server close");
    await withShutdownTimeout(closeSocketServer(), "Socket.IO close");
    await closeQueueRuntime();
    await withShutdownTimeout(closeRedisClients(), "Redis clients close");
    await withShutdownTimeout(pool.end(), "PostgreSQL pool close");
    logger.info("API server shutdown complete", { signal });
    process.exit(0);
  } catch (err) {
    logger.error("API server shutdown failed", { signal, err });
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function startServer() {
  if (isProductionLike(process.env.APP_ENV)) {
    await assertMigrationsCurrent();
  } else {
    await ensureUserIdentityConstraints();
    await ensureRestrictionSchema();
    await ensureReservationInteractionLockSchema();
    await ensurePaymentHardeningSchema();
    await ensureObservabilitySchema();
  }

  server.listen(PORT, () => {
    logger.info("API server running", { port: PORT });
  });
}

startServer().catch((err) => {
  logger.error("API server failed to start", { err });
  process.exit(1);
});
