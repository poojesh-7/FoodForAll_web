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
const { isValidId } = require("../../utils/validation");

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
      return next(new Error("Unauthorized"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id || !isValidId(decoded.id)) {
      return next(new Error("Invalid token"));
    }

    socket.user = decoded;
    socket.data.user = decoded;

    next();
  } catch {
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

  console.log("Socket connected:", socket.id);

  if (!userId) {
    socket.disconnect(true);
    return;
  }

  socket.join(`user:${userId}`);

  socket.on("join", (requestedUserId, ack) => {
    if (String(requestedUserId) !== String(userId)) {
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
    console.log("Socket disconnected:", socket.id);
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
      console.error("Socket event error:", err);
    }
  });

  console.log("Socket event bridge running");
}

startSocketBridge();

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

app.use((err, req, res, next) => {
  if (err?.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed by CORS",
      data: null,
    });
  }

  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON body",
      data: null,
    });
  }

  return next(err);
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`API Server running on ${PORT}`);
});
