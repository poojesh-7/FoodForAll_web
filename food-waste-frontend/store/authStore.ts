import { create } from "zustand";
import api from "@/lib/axios";
import { User } from "@/types/auth";

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  fetchMe: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,

  setUser: (user) => set({ user }),

  fetchMe: async () => {
    try {
      set({ loading: true });

      // 🍪 cookies automatically sent
      const res = await api.get("/auth/me");

      set({
        user: res.data.user,
      });

    } catch {
      // ❌ if unauthorized → user is not logged in
      set({ user: null });
    } finally {
      set({ loading: false });
    }
  },
  logout: async () => {
    try {
      await api.post("/auth/logout");

      // clear state
      set({ user: null });

      // redirect
      window.location.href = "/login";

    } catch (err) {
      console.error(err);
    }
  },
}));