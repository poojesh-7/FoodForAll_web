import { create } from "zustand";
import { isUserOnboarded } from "@/lib/onboarding";
import * as authApi from "@/services/auth";
import type { AuthMeUser, AuthUser } from "@backend/contracts/api-contracts";

type AuthStoreUser = AuthMeUser | AuthUser;

const AUTH_HYDRATION_ATTEMPTS = 3;
const AUTH_HYDRATION_RETRY_DELAY_MS = 350;

let authOperationId = 0;

function claimAuthOperation() {
  authOperationId += 1;
  return authOperationId;
}

function isCurrentAuthOperation(operationId: number) {
  return operationId === authOperationId;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchMeWithRecovery() {
  let lastError: unknown;

  for (let attempt = 0; attempt < AUTH_HYDRATION_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 0) {
        await delay(AUTH_HYDRATION_RETRY_DELAY_MS * attempt);
      }

      return await authApi.fetchMe();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

interface AuthState {
  user: AuthStoreUser | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isOnboarded: boolean;
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
  ) => Promise<{ user: AuthStoreUser; isNewUser: boolean } | null>;
  setRole: (role: authApi.SetRolePayload["role"]) => Promise<AuthStoreUser | null>;
  completeProfile: (
    params: authApi.CompleteProfilePayload
  ) => Promise<AuthStoreUser | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isInitializing: false,
  isOnboarded: false,
  initialized: false,
  loading: false,
  authError: null,
  authSuccess: null,

  setUser: (user) => {
    claimAuthOperation();
    set({
      user,
      isAuthenticated: Boolean(user),
      isOnboarded: isUserOnboarded(user),
      initialized: true,
      isInitializing: false,
      authError: null,
      authSuccess: null,
    });
  },

  clearMessages: () => set({ authError: null, authSuccess: null }),

  fetchMe: async () => {
    const operationId = claimAuthOperation();

    try {
      set({ isInitializing: true, authError: null, authSuccess: null });
      const user = await fetchMeWithRecovery();

      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        user,
        isAuthenticated: true,
        isOnboarded: isUserOnboarded(user),
        initialized: true,
        isInitializing: false,
        authError: null,
        authSuccess: null,
      });

      return user;
    } catch {
      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        user: null,
        isAuthenticated: false,
        isOnboarded: false,
        initialized: true,
        isInitializing: false,
        authError: null,
        authSuccess: null,
      });

      return null;
    } finally {
      if (isCurrentAuthOperation(operationId)) {
        set({ isInitializing: false });
      }
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
    const operationId = claimAuthOperation();

    try {
      set({
        loading: true,
        isInitializing: true,
        authError: null,
        authSuccess: null,
      });
      const result = await authApi.verifyOtp(params);
      const user = await fetchMeWithRecovery();

      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        user,
        isAuthenticated: true,
        isOnboarded: isUserOnboarded(user),
        initialized: true,
        isInitializing: false,
        authError: null,
        authSuccess: result.message || "Login successful.",
      });

      return {
        user,
        isNewUser: result.isNewUser,
      };
    } catch (error) {
      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        user: null,
        isAuthenticated: false,
        isOnboarded: false,
        initialized: true,
        isInitializing: false,
        authError: authApi.getErrorMessage(error),
        authSuccess: null,
      });

      return null;
    } finally {
      if (isCurrentAuthOperation(operationId)) {
        set({ loading: false });
      }
    }
  },

  setRole: async (role) => {
    const operationId = claimAuthOperation();

    try {
      set({ loading: true, authError: null, authSuccess: null });
      const result = await authApi.setRole({ role });
      const me = await authApi.fetchMe().catch(() => null);
      const user = me ?? result.user;

      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        user,
        isAuthenticated: true,
        isOnboarded: isUserOnboarded(user),
        initialized: true,
        isInitializing: false,
        authError: null,
        authSuccess: "Role saved successfully.",
      });

      return user;
    } catch (error) {
      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        authError: authApi.getErrorMessage(error),
        authSuccess: null,
      });

      return null;
    } finally {
      if (isCurrentAuthOperation(operationId)) {
        set({ loading: false });
      }
    }
  },

  completeProfile: async (params) => {
    const operationId = claimAuthOperation();

    try {
      set({ loading: true, authError: null, authSuccess: null });
      const result = await authApi.completeProfile(params);
      const me = await authApi.fetchMe().catch(() => null);
      const user = me ?? result.user;

      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        user,
        isAuthenticated: true,
        isOnboarded: isUserOnboarded(user),
        initialized: true,
        isInitializing: false,
        authError: null,
        authSuccess: "Profile completed successfully.",
      });

      return user;
    } catch (error) {
      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        authError: authApi.getErrorMessage(error),
        authSuccess: null,
      });

      return null;
    } finally {
      if (isCurrentAuthOperation(operationId)) {
        set({ loading: false });
      }
    }
  },

  logout: async () => {
    const operationId = claimAuthOperation();

    try {
      set({ loading: true, authError: null, authSuccess: null });
      await authApi.logout();
    } catch (error) {
      console.error(error);
    } finally {
      if (isCurrentAuthOperation(operationId)) {
        set({
          user: null,
          isAuthenticated: false,
          isOnboarded: false,
          initialized: true,
          isInitializing: false,
          loading: false,
          authError: null,
          authSuccess: null,
        });
      }

      if (typeof window !== "undefined") {
        window.location.assign("/login");
      }
    }
  },
}));
