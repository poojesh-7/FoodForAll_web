import { create } from "zustand";
import * as authApi from "@/services/auth";
import type { AuthMeUser, AuthUser } from "@backend/contracts/api-contracts";

type AuthStoreUser = AuthMeUser | AuthUser;

interface AuthState {
  user: AuthStoreUser | null;
  isAuthenticated: boolean;
  initialized: boolean;
  loading: boolean;
  authError: string | null;
  authSuccess: string | null;
  setUser: (user: AuthStoreUser | null) => void;
  clearMessages: () => void;
  fetchMe: () => Promise<AuthMeUser | null>;
  sendOtp: (phone: string) => Promise<boolean>;
  verifyOtp: (
    params: authApi.VerifyOtpPayload
  ) => Promise<{ user: AuthUser; isNewUser: boolean } | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  initialized: false,
  loading: false,
  authError: null,
  authSuccess: null,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: Boolean(user),
      initialized: true,
      authError: null,
      authSuccess: null,
    }),

  clearMessages: () => set({ authError: null, authSuccess: null }),

  fetchMe: async () => {
    try {
      set({ loading: true, authError: null, authSuccess: null });
      const user = await authApi.fetchMe();

      set({
        user,
        isAuthenticated: true,
        initialized: true,
        authError: null,
        authSuccess: null,
      });

      return user;
    } catch {
      set({
        user: null,
        isAuthenticated: false,
        initialized: true,
        authError: null,
        authSuccess: null,
      });

      return null;
    } finally {
      set({ loading: false });
    }
  },

  sendOtp: async (phone) => {
    try {
      set({ loading: true, authError: null, authSuccess: null });
      const response = await authApi.sendOtp({ phone });

      set({
        authError: null,
        authSuccess: response.message || "OTP sent successfully.",
      });

      return true;
    } catch (error) {
      set({
        authError: authApi.getErrorMessage(error),
        authSuccess: null,
      });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  verifyOtp: async (params) => {
    try {
      set({ loading: true, authError: null, authSuccess: null });
      const result = await authApi.verifyOtp(params);

      set({
        user: result.user,
        isAuthenticated: true,
        initialized: true,
        authError: null,
        authSuccess: result.message || "Login successful.",
      });

      return {
        user: result.user,
        isNewUser: result.isNewUser,
      };
    } catch (error) {
      set({
        user: null,
        isAuthenticated: false,
        initialized: true,
        authError: authApi.getErrorMessage(error),
        authSuccess: null,
      });

      return null;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      set({ loading: true, authError: null, authSuccess: null });
      await authApi.logout();
    } catch (error) {
      console.error(error);
    } finally {
      set({
        user: null,
        isAuthenticated: false,
        initialized: true,
        loading: false,
        authError: null,
        authSuccess: null,
      });

      if (typeof window !== "undefined") {
        window.location.assign("/login");
      }
    }
  },
}));
