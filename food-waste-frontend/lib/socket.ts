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
