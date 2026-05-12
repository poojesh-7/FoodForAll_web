"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Socket } from "socket.io-client";
import toast from "react-hot-toast";
import { socket } from "@/lib/socket";
import { useAuthStore } from "@/store/authStore";
import {
  subscribeNotificationSync,
  useNotificationStore,
} from "@/store/notificationStore";
import { useRealtimeStore } from "@/store/realtimeStore";
import type { NotificationRow } from "@backend/contracts/api-contracts";

type SocketContextValue = {
  socket: Socket;
  connected: boolean;
};

const SocketContext = createContext<SocketContextValue | null>(null);

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used inside SocketProvider");
  }
  return context;
}

export default function SocketProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const applyReservation = useRealtimeStore.getState().applyReservation;
    const applyPayment = useRealtimeStore.getState().applyPayment;
    const applyVolunteer = useRealtimeStore.getState().applyVolunteer;
    const applyListing = useRealtimeStore.getState().applyListing;
    const receiveNotification =
      useNotificationStore.getState().receiveNotification;
    const handleNotification = (notification: NotificationRow) => {
      receiveNotification(notification);
      toast(
        notification.message
          ? `${notification.title || "New notification"}: ${notification.message}`
          : notification.title || "New notification"
      );
    };

    socket.on("reservation_updated", applyReservation);
    socket.on("task_claimed", applyReservation);
    socket.on("payment_updated", applyPayment);
    socket.on("volunteer_updated", applyVolunteer);
    socket.on("listing_updated", applyListing);
    socket.on("notification", handleNotification);

    return () => {
      socket.off("reservation_updated", applyReservation);
      socket.off("task_claimed", applyReservation);
      socket.off("payment_updated", applyPayment);
      socket.off("volunteer_updated", applyVolunteer);
      socket.off("listing_updated", applyListing);
      socket.off("notification", handleNotification);
    };
  }, []);

  useEffect(() => subscribeNotificationSync(), []);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      if (user?.id) {
        socket.emit("join", user.id);
      }
    };
    const handleDisconnect = () => setConnected(false);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      if (socket.connected) socket.disconnect();
      useRealtimeStore.getState().resetRealtime();
      useNotificationStore.getState().resetNotifications();
      return;
    }

    socket.auth = { userId: user.id };

    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit("join", user.id);
    }
  }, [isAuthenticated, user?.id]);

  const value = useMemo(() => ({ socket, connected }), [connected]);

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}
