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
  reconnecting: boolean;
  offline: boolean;
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
  const initialized = useAuthStore((state) => state.initialized);
  const isInitializing = useAuthStore((state) => state.isInitializing);
  const isOnboarded = useAuthStore((state) => state.isOnboarded);
  const [connected, setConnected] = useState(socket.connected);
  const [reconnecting, setReconnecting] = useState(false);
  const [offline, setOffline] = useState(false);

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
      setReconnecting(false);
      if (user?.id) {
        socket.emit("join", user.id);
      }
    };
    const handleDisconnect = () => {
      setConnected(false);
      setReconnecting(true);
    };
    const handleReconnectAttempt = () => setReconnecting(true);
    const handleConnectError = () => setReconnecting(true);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.io.on("reconnect_attempt", handleReconnectAttempt);
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.io.off("reconnect_attempt", handleReconnectAttempt);
      socket.off("connect_error", handleConnectError);
    };
  }, [user?.id]);

  useEffect(() => {
    const updateOnlineState = () => {
      setOffline(!window.navigator.onLine);
      if (window.navigator.onLine && socket.active && !socket.connected) {
        setReconnecting(true);
        socket.connect();
      }
    };

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (
      !initialized ||
      isInitializing ||
      !isAuthenticated ||
      !isOnboarded ||
      !user?.id
    ) {
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
  }, [initialized, isAuthenticated, isInitializing, isOnboarded, user?.id]);

  const value = useMemo(
    () => ({ socket, connected, reconnecting, offline }),
    [connected, reconnecting, offline]
  );

  return (
    <SocketContext.Provider value={value}>
      <ConnectionStatusBanner
        connected={connected}
        reconnecting={reconnecting}
        offline={offline}
      />
      {children}
    </SocketContext.Provider>
  );
}

function ConnectionStatusBanner({
  connected,
  reconnecting,
  offline,
}: {
  connected: boolean;
  reconnecting: boolean;
  offline: boolean;
}) {
  if (connected && !offline) return null;

  const message = offline
    ? "You are offline. Changes will need a refresh when your connection returns."
    : reconnecting
      ? "Reconnecting live updates..."
      : "Live updates are disconnected.";

  return (
    <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-800">
      {message}
    </div>
  );
}
