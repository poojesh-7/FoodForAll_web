import { io } from "socket.io-client";

const DEFAULT_SOCKET_URL = "http://localhost:5000";

function getSocketUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!configuredUrl) return DEFAULT_SOCKET_URL;

  return configuredUrl.replace(/\/api\/v1\/?$/, "").replace(/\/+$/, "");
}

export const socket = io(getSocketUrl(), {
  autoConnect: false,
  reconnection: true,
  withCredentials: true,
});
