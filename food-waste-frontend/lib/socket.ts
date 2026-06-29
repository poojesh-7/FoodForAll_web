import { io } from "socket.io-client";
import { getPublicSocketUrl } from "./env";

export const socket = io(getPublicSocketUrl(), {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  withCredentials: true,
});

let observedEngine: typeof socket.io.engine | null = null;

function logSocketTransport(message: string, details: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== "production") return;

  console.info("[socket.io]", message, details);
}

socket.on("connect", () => {
  const engine = socket.io.engine;

  logSocketTransport("connected", {
    id: socket.id,
    transport: engine?.transport?.name,
  });

  if (!engine || observedEngine === engine) return;

  observedEngine = engine;

  engine.on("upgrade", (transport: { name?: string }) => {
    logSocketTransport("transport upgraded", {
      from: "polling",
      transport: transport.name,
    });
  });

  engine.on("upgradeError", (error: Error) => {
    logSocketTransport("transport upgrade failed", {
      transport: engine?.transport?.name,
      message: error?.message,
    });
  });
});

socket.on("connect_error", (error) => {
  logSocketTransport("connect error", {
    transport: socket.io.engine?.transport?.name,
    message: error.message,
  });
});
