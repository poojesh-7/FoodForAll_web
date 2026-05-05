import { create } from "zustand";
import { socket } from "@/lib/socket";

interface SocketState {
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
}

export const useSocketStore = create<SocketState>((set) => ({
  connected: false,

  connect: () => {
    socket.connect();

    socket.on("connect", () => {
      set({ connected: true });
    });

    socket.on("disconnect", () => {
      set({ connected: false });
    });
  },

  disconnect: () => {
    socket.disconnect();
    set({ connected: false });
  },
}));