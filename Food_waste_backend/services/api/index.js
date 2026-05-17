const { validateEnvironment } = require("../../shared/config/env");
validateEnvironment();
require("../../shared/config/db");
const redis = require("../../shared/config/redis");
const bullBoardServer = require("../../admin/bullBoard");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const {
  buildCorsOptions,
  buildHelmetMiddleware,
  buildSocketCorsOptions,
} = require("../../middlewares/security.middleware");
const {
  errorHandler,
  notFoundHandler,
} = require("../../middlewares/error.middleware");
const { isValidId } = require("../../utils/validation");
const logger = require("../../shared/utils/logger");
const {
  ensureUserIdentityConstraints,
} = require("../../shared/services/userIdentityConstraints.service");
const { ensureRestrictionSchema } = require("../../shared/services/restrictionSchema.service");
const {
  ensureReservationInteractionLockSchema,
} = require("../../shared/services/reservationLock.service");

const app = express();
const server = http.createServer(app);
const paymentRoutes = require("../../routes/payment.routes");
const corsOptions = buildCorsOptions();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const io = new Server(server, {
  cors: buildSocketCorsOptions(),
  pingInterval: 25000,
  pingTimeout: 20000,
});
const cookieParser = require("cookie-parser");
const cookie = require("cookie");

app.use(cookieParser());
app.use(buildHelmetMiddleware());
app.use(cors(corsOptions));
// require("../../admin/cleanup");
const jwt = require("jsonwebtoken");

io.use((socket, next) => {
  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    const token = socket.handshake.auth?.token || cookies.accessToken;

    if (!token) {
      logger.warn("Socket authentication failed", {
        reason: "missing_token",
        socketId: socket.id,
        ip: socket.handshake.address,
      });
      return next(new Error("Unauthorized"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id || !isValidId(decoded.id)) {
      logger.warn("Socket authentication failed", {
        reason: "invalid_user_id",
        socketId: socket.id,
        ip: socket.handshake.address,
      });
      return next(new Error("Invalid token"));
    }

    socket.user = decoded;
    socket.data.user = decoded;

    next();
  } catch (err) {
    logger.warn("Socket authentication failed", {
      reason: "invalid_token",
      socketId: socket.id,
      ip: socket.handshake.address,
      err,
    });
    next(new Error("Invalid token"));
  }
});

app.use("/api/v1/payments", paymentRoutes);

app.use(express.json({ limit: "1mb" }));
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

async function startSocketBridge() {
  const subscriber = redis.duplicate();

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
app.use("/api/v1/volunteers", volunteerRoutes);
app.use("/api/v1/ratings", ratingRoutes);
app.use("/api/v1/impact", impactRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/admin/queues", authMiddleware, requireAdmin, bullBoardServer.getRouter());

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { err });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    err: reason instanceof Error ? reason : new Error(String(reason)),
  });
});

async function startServer() {
  await ensureUserIdentityConstraints();
  await ensureRestrictionSchema();
  await ensureReservationInteractionLockSchema();

  server.listen(PORT, () => {
    logger.info("API server running", { port: PORT });
  });
}

startServer().catch((err) => {
  logger.error("API server failed to start", { err });
  process.exit(1);
});
