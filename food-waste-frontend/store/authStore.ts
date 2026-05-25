import { create } from "zustand";
import { resetAuthRefreshFailure } from "@/lib/axios";
import { isUserOnboarded } from "@/lib/onboarding";
import * as authApi from "@/services/auth";
import type { AuthMeUser, AuthUser } from "@shared/contracts/api-contracts";

type AuthStoreUser = AuthMeUser | AuthUser;
type SendOtpOutcome = {
  sent: boolean;
  retryAfter?: number | null;
};

const AUTH_HYDRATION_ATTEMPTS = 2;
const AUTH_HYDRATION_RETRY_DELAY_MS = 350;
const POST_LOGIN_COOKIE_SETTLE_DELAY_MS = 100;

let authOperationId = 0;
let bootstrapPromise: Promise<AuthMeUser | null> | null = null;

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

function getResponseStatus(error: unknown) {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    return typeof response?.status === "number" ? response.status : null;
  }

  return null;
}

async function fetchMeWithRecovery({
  attempts = 1,
  retryUnauthorized = false,
}: {
  attempts?: number;
  retryUnauthorized?: boolean;
} = {}) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (attempt > 0) {
        await delay(AUTH_HYDRATION_RETRY_DELAY_MS * attempt);
      }

      return await authApi.fetchMe();
    } catch (error) {
      lastError = error;

      if (!retryUnauthorized && getResponseStatus(error) === 401) {
        break;
      }
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
  authBootstrapped: boolean;
  loading: boolean;
  authError: string | null;
  authSuccess: string | null;
  authRetryAfter: number | null;
  setUser: (user: AuthStoreUser | null) => void;
  clearMessages: () => void;
  bootstrapAuth: () => Promise<AuthMeUser | null>;
  fetchMe: () => Promise<AuthMeUser | null>;
  sendOtp: (phone: string) => Promise<SendOtpOutcome>;
  verifyOtp: (
    params: authApi.VerifyOtpPayload
  ) => Promise<{ user: AuthStoreUser; isNewUser: boolean } | null>;
  setRole: (role: authApi.SetRolePayload["role"]) => Promise<AuthStoreUser | null>;
  completeProfile: (
    params: authApi.CompleteProfilePayload
  ) => Promise<AuthStoreUser | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isInitializing: false,
  isOnboarded: false,
  initialized: false,
  authBootstrapped: false,
  loading: false,
  authError: null,
  authSuccess: null,
  authRetryAfter: null,

  setUser: (user) => {
    claimAuthOperation();
    set({
      user,
      isAuthenticated: Boolean(user),
      isOnboarded: isUserOnboarded(user),
      initialized: true,
      authBootstrapped: true,
      isInitializing: false,
      authError: null,
      authSuccess: null,
    });
  },

  clearMessages: () => set({ authError: null, authSuccess: null, authRetryAfter: null }),

  bootstrapAuth: async () => {
    const state = get();

    if (state.authBootstrapped) {
      return state.user as AuthMeUser | null;
    }

    if (bootstrapPromise) return bootstrapPromise;

    const operationId = claimAuthOperation();

    bootstrapPromise = (async () => {
      set({ isInitializing: true, authError: null, authSuccess: null });

      try {
        const user = await fetchMeWithRecovery();

        if (!isCurrentAuthOperation(operationId)) {
          return null;
        }

        set({
          user,
          isAuthenticated: true,
          isOnboarded: isUserOnboarded(user),
          initialized: true,
          authBootstrapped: true,
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
          authBootstrapped: true,
          isInitializing: false,
          authError: null,
          authSuccess: null,
        });

        return null;
      } finally {
        if (isCurrentAuthOperation(operationId)) {
          set({ isInitializing: false });
        }

        bootstrapPromise = null;
      }
    })();

    return bootstrapPromise;
  },

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
        authBootstrapped: true,
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
        authBootstrapped: true,
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
      set({ loading: true, authError: null, authSuccess: null, authRetryAfter: null });
      const response = await authApi.sendOtp({ phone });
      const resendAfter = Number(
        (response.data as { resendAfter?: unknown } | null)?.resendAfter
      );

      set({
        authError: null,
        authSuccess: response.message || "OTP sent successfully.",
        authRetryAfter: Number.isFinite(resendAfter) && resendAfter > 0
          ? Math.ceil(resendAfter)
          : null,
      });

      return {
        sent: true,
        retryAfter: Number.isFinite(resendAfter) && resendAfter > 0
          ? Math.ceil(resendAfter)
          : null,
      };
    } catch (error) {
      const retryAfter = authApi.getRetryAfter(error);
      set({
        authError: authApi.getErrorMessage(error),
        authSuccess: null,
        authRetryAfter: retryAfter,
      });
      return { sent: false, retryAfter };
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
      resetAuthRefreshFailure();
      await delay(POST_LOGIN_COOKIE_SETTLE_DELAY_MS);
      const user = await fetchMeWithRecovery({
        attempts: AUTH_HYDRATION_ATTEMPTS,
        retryUnauthorized: true,
      });

      if (!isCurrentAuthOperation(operationId)) {
        return null;
      }

      set({
        user,
        isAuthenticated: true,
        isOnboarded: isUserOnboarded(user),
        initialized: true,
        authBootstrapped: true,
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
        authBootstrapped: true,
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
        authBootstrapped: true,
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
        authBootstrapped: true,
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
          authBootstrapped: true,
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
