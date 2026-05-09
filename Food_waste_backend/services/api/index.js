require("../../shared/config/db");
const redis = require("../../shared/config/redis");
const bullBoardServer = require("../../admin/bullBoard");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const paymentRoutes = require("../../routes/payment.routes");
const frontendOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

const io = new Server(server, {
  cors: {
    origin: frontendOrigin,
    credentials: true,
  },
});
const cookieParser = require("cookie-parser");

app.use(cookieParser());
// require("../../admin/cleanup");
const jwt = require("jsonwebtoken");

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Unauthorized"));
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    socket.user = decoded;

    next();
  } catch {
    next(new Error("Invalid token"));
  }
});


app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
  })
);

app.use("/api/v1/payments", paymentRoutes);

app.use(express.json());
app.set("io", io);

/*
========================
Socket Connections
========================
*/

io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);

  socket.on("join", (userId) => {
    socket.join(`user:${userId}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
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

      io.to(payload.room).emit(payload.event, payload.data);
    } catch (err) {
      console.error("Socket event error:", err);
    }
  });

  console.log("📡 Socket event bridge running");
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


const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 API Server running on ${PORT}`);
});
