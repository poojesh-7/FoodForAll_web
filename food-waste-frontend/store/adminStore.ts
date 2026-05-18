import { create } from "zustand";
import {
  adminService,
  type AdminNGO,
  type AdminRestaurant,
} from "@/services/admin.service";
import type {
  AdminOperationalAlert,
  AdminOperationalSummary,
  AdminPaymentHealth,
  AdminQueueHealth,
  AdminSecurityEvent,
  DbId,
} from "@backend/contracts/api-contracts";

interface AdminState {
  ngos: AdminNGO[];
  restaurants: AdminRestaurant[];
  summary: AdminOperationalSummary | null;
  queues: AdminQueueHealth[];
  payments: AdminPaymentHealth | null;
  alerts: AdminOperationalAlert[];
  securityEvents: AdminSecurityEvent[];
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  loadModeration: () => Promise<void>;
  loadOperations: () => Promise<void>;
  loadQueues: () => Promise<void>;
  loadMonitoring: () => Promise<void>;
  approveNGO: (id: DbId) => Promise<void>;
  rejectNGO: (id: DbId, reason: string) => Promise<void>;
  approveRestaurant: (id: DbId) => Promise<void>;
  rejectRestaurant: (id: DbId, reason: string) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  ngos: [],
  restaurants: [],
  summary: null,
  queues: [],
  payments: null,
  alerts: [],
  securityEvents: [],
  loading: false,
  actionLoading: false,
  error: null,

  loadModeration: async () => {
    try {
      set({ loading: true, error: null });
      const [ngos, restaurants] = await Promise.all([
        adminService.getPendingNGOs(),
        adminService.getPendingRestaurants(),
      ]);
      set({ ngos, restaurants });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  loadOperations: async () => {
    try {
      set({ loading: true, error: null });
      const [summary, payments, alerts, securityEvents] = await Promise.all([
        adminService.getOperationalSummary(),
        adminService.getPaymentHealth(),
        adminService.getOperationalAlerts(),
        adminService.getSecurityEvents(),
      ]);
      set({ summary, payments, alerts, securityEvents });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  loadQueues: async () => {
    try {
      set({ loading: true, error: null });
      const queues = await adminService.getQueueHealth();
      set({ queues });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  loadMonitoring: async () => {
    try {
      set({ loading: true, error: null });
      const [queues, payments, alerts, securityEvents] = await Promise.all([
        adminService.getQueueHealth(),
        adminService.getPaymentHealth(),
        adminService.getOperationalAlerts(),
        adminService.getSecurityEvents(),
      ]);
      set({ queues, payments, alerts, securityEvents });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  approveNGO: async (id) => {
    set({ actionLoading: true, error: null });
    try {
      await adminService.approveNGO(id);
      set({ ngos: get().ngos.filter((ngo) => ngo.id !== id) });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ actionLoading: false });
    }
  },

  rejectNGO: async (id, reason) => {
    set({ actionLoading: true, error: null });
    try {
      await adminService.rejectNGO(id, reason);
      set({ ngos: get().ngos.filter((ngo) => ngo.id !== id) });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ actionLoading: false });
    }
  },

  approveRestaurant: async (id) => {
    set({ actionLoading: true, error: null });
    try {
      await adminService.approveRestaurant(id);
      set({
        restaurants: get().restaurants.filter((restaurant) => restaurant.id !== id),
      });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ actionLoading: false });
    }
  },

  rejectRestaurant: async (id, reason) => {
    set({ actionLoading: true, error: null });
    try {
      await adminService.rejectRestaurant(id, reason);
      set({
        restaurants: get().restaurants.filter((restaurant) => restaurant.id !== id),
      });
    } catch (error) {
      set({ error: adminService.getErrorMessage(error) });
    } finally {
      set({ actionLoading: false });
    }
  },
}));
