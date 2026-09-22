"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import {
  BadgeIndianRupee,
  CheckCircle2,
  Leaf,
  MapPin,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";
import { PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import {
  getPublicGoogleClientId,
  isVolunteerNgoAuthEnabled,
} from "@/lib/env";
import { getPostAuthRedirect } from "@/lib/onboarding";
import { useAuthStore } from "@/store/authStore";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleAccounts = {
  accounts?: {
    id?: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      cancel?: () => void;
      renderButton: (
        element: HTMLElement,
        options: {
          theme: "outline" | "filled_blue" | "filled_black";
          size: "large" | "medium" | "small";
          text: "continue_with" | "signin_with" | "signup_with";
          shape: "rectangular" | "pill" | "circle" | "square";
          width?: number;
          click_listener?: () => void;
        }
      ) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const GOOGLE_SDK_POLL_INTERVAL_MS = 100;
const GOOGLE_SDK_READY_TIMEOUT_MS = 8000;
const GOOGLE_SDK_LOAD_ERROR =
  "Google sign-in could not load. Check your connection, refresh the page, or try again later.";
const GOOGLE_SDK_INIT_ERROR =
  "Google sign-in could not start. Refresh the page and try again.";
const GOOGLE_BUTTON_RENDER_ERROR =
  "Google sign-in button could not render. Refresh the page and try again.";
const GOOGLE_POPUP_NOTICE =
  "If the Google sign-in window did not open, allow pop-ups for this site and try again.";
const GOOGLE_CREDENTIAL_ERROR =
  "Google sign-in was cancelled or did not return account details. Please try again.";
const GOOGLE_POPUP_NOTICE_DELAY_MS = 5000;
const GOOGLE_BUTTON_MAX_WIDTH = 320;
const GOOGLE_BUTTON_MIN_WIDTH = 200;

type GoogleSdkStatus = "loading" | "ready" | "failed";

let initializedGoogleClientId: string | null = null;
let activeGoogleCredentialHandler:
  | ((response: GoogleCredentialResponse) => void)
  | null = null;

function isGoogleSdkReady() {
  const googleAccountsId = window.google?.accounts?.id;
  return Boolean(
    googleAccountsId?.initialize && googleAccountsId?.renderButton
  );
}

function getInitialGoogleSdkStatus(): GoogleSdkStatus {
  if (typeof window === "undefined") return "loading";
  return isGoogleSdkReady() ? "ready" : "loading";
}

function getSafeNextPath() {
  if (typeof window === "undefined") return null;

  const nextPath = new URLSearchParams(window.location.search).get("next");
  return nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : null;
}

function getRequestedRole() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const requestedRole = params.get("role");
  if (requestedRole === "provider") return "provider" as const;
  if (requestedRole === "ngo" && isVolunteerNgoAuthEnabled()) return "ngo" as const;
  if (requestedRole === "volunteer" && isVolunteerNgoAuthEnabled()) {
    return "volunteer" as const;
  }

  const nextPath = params.get("next");
  if (nextPath === "/provider/register" || nextPath === "/restaurant/register") {
    return "provider" as const;
  }

  return null;
}

function getInitialSessionNotice() {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  if (params.get("session") === "expired") {
    return "Your session has expired. Please sign in again.";
  }

  if (params.get("logout") === "partial") {
    return "You were signed out locally, but server session revocation could not be confirmed.";
  }

  return "";
}

function initializeGoogleIdentity(
  clientId: string,
  onCredential: (response: GoogleCredentialResponse) => void
) {
  const googleAccountsId = window.google?.accounts?.id;

  if (!googleAccountsId?.initialize) {
    throw new Error("Google Identity Services is not ready.");
  }

  activeGoogleCredentialHandler = onCredential;

  if (initializedGoogleClientId === clientId) {
    return;
  }

  googleAccountsId.initialize({
    client_id: clientId,
    callback: (response) => {
      activeGoogleCredentialHandler?.(response);
    },
  });
  initializedGoogleClientId = clientId;
}

function clearGoogleButtonContainer(element: HTMLElement | null) {
  if (!element) return;
  element.innerHTML = "";
}

export default function LoginPage() {
  const router = useRouter();
  const googleClientId = getPublicGoogleClientId();
  const [redirecting, setRedirecting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleSdkStatus, setGoogleSdkStatus] = useState<GoogleSdkStatus>(
    getInitialGoogleSdkStatus
  );
  const [googleSdkError, setGoogleSdkError] = useState("");
  const [sessionNotice, setSessionNotice] = useState(getInitialSessionNotice);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleAuthBusyRef = useRef(false);
  const redirectingRef = useRef(false);
  const popupNoticeTimerRef = useRef<number | null>(null);
  const [googlePopupNotice, setGooglePopupNotice] = useState("");
  const [googleButtonWidth, setGoogleButtonWidth] = useState<number | null>(
    null
  );

  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const authError = useAuthStore((state) => state.authError);
  const authSuccess = useAuthStore((state) => state.authSuccess);
  const googleLogin = useAuthStore((state) => state.googleLogin);
  const setRole = useAuthStore((state) => state.setRole);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const clearPopupNoticeTimer = useCallback(() => {
    if (popupNoticeTimerRef.current === null) return;

    window.clearTimeout(popupNoticeTimerRef.current);
    popupNoticeTimerRef.current = null;
  }, []);

  const schedulePopupNotice = useCallback(() => {
    clearPopupNoticeTimer();
    setGooglePopupNotice("");
    popupNoticeTimerRef.current = window.setTimeout(() => {
      setGooglePopupNotice(GOOGLE_POPUP_NOTICE);
    }, GOOGLE_POPUP_NOTICE_DELAY_MS);
  }, [clearPopupNoticeTimer]);

  useEffect(() => {
    clearMessages();
  }, [clearMessages]);

  useEffect(() => {
    if (!user?.id) return;

    const redirectPath = getPostAuthRedirect(user);
    router.replace(
      redirectPath === "/dashboard" ? getSafeNextPath() ?? redirectPath : redirectPath
    );
  }, [router, user]);

  const finishAuthRedirect = useCallback(
    (nextUser: NonNullable<typeof user>) => {
      redirectingRef.current = true;
      setRedirecting(true);
      const redirectPath = getPostAuthRedirect(nextUser);
      router.replace(
        redirectPath === "/dashboard"
          ? getSafeNextPath() ?? redirectPath
          : redirectPath
      );
    },
    [router]
  );

  const handleGoogleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      if (
        googleAuthBusyRef.current ||
        redirectingRef.current
      ) {
        return;
      }

      clearPopupNoticeTimer();

      if (!response.credential) {
        setGooglePopupNotice("");
        setGoogleSdkError(GOOGLE_CREDENTIAL_ERROR);
        return;
      }

      clearMessages();
      setSessionNotice("");
      setGooglePopupNotice("");
      setGoogleSdkError("");
      googleAuthBusyRef.current = true;
      setGoogleLoading(true);

      const result = await googleLogin({ credential: response.credential }).finally(
        () => {
          googleAuthBusyRef.current = false;
          setGoogleLoading(false);
        }
      );

      if (result?.user) {
        let authenticatedUser = result.user;
        const requestedRole = getRequestedRole();
        const onboardingRole = requestedRole ||
          (authenticatedUser.role ? null : "user");

        if (onboardingRole && authenticatedUser.role !== onboardingRole) {
          const updatedUser = await setRole(onboardingRole);
          if (!updatedUser) return;
          authenticatedUser = updatedUser;
        }

        finishAuthRedirect(authenticatedUser);
      }
    },
    [
      clearMessages,
      finishAuthRedirect,
      googleLogin,
      clearPopupNoticeTimer,
      setRole,
    ]
  );

  const markGoogleSdkReady = useCallback(() => {
    if (!isGoogleSdkReady()) return false;

    setGoogleSdkError("");
    setGoogleSdkStatus("ready");
    return true;
  }, []);

  const markGoogleSdkFailed = useCallback(() => {
    if (markGoogleSdkReady()) return;

    setGoogleSdkStatus("failed");
    setGoogleSdkError(GOOGLE_SDK_LOAD_ERROR);
  }, [markGoogleSdkReady]);

  useEffect(() => {
    if (!googleClientId || googleSdkStatus !== "loading") return;

    let settled = false;
    const startedAt = Date.now();

    const checkReady = () => {
      if (settled) return;

      if (markGoogleSdkReady()) {
        settled = true;
        return;
      }

      if (Date.now() - startedAt >= GOOGLE_SDK_READY_TIMEOUT_MS) {
        settled = true;
        markGoogleSdkFailed();
      }
    };

    const initialCheck = window.setTimeout(checkReady, 0);
    const readinessPoll = window.setInterval(
      checkReady,
      GOOGLE_SDK_POLL_INTERVAL_MS
    );

    return () => {
      settled = true;
      window.clearTimeout(initialCheck);
      window.clearInterval(readinessPoll);
    };
  }, [
    googleClientId,
    googleSdkStatus,
    markGoogleSdkFailed,
    markGoogleSdkReady,
  ]);

  useEffect(() => {
    const googleButtonElement = googleButtonRef.current;
    if (!googleButtonElement || !googleClientId || googleSdkStatus === "failed") {
      return;
    }

    const updateGoogleButtonWidth = () => {
      const availableWidth = Math.floor(googleButtonElement.clientWidth);
      if (!availableWidth) return;

      setGoogleButtonWidth(
        Math.min(
          GOOGLE_BUTTON_MAX_WIDTH,
          Math.max(GOOGLE_BUTTON_MIN_WIDTH, availableWidth)
        )
      );
    };

    updateGoogleButtonWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateGoogleButtonWidth);
      return () =>
        window.removeEventListener("resize", updateGoogleButtonWidth);
    }

    const resizeObserver = new ResizeObserver(updateGoogleButtonWidth);
    resizeObserver.observe(googleButtonElement);

    return () => resizeObserver.disconnect();
  }, [googleClientId, googleSdkStatus]);

  useEffect(() => {
    const googleButtonElement = googleButtonRef.current;
    if (
      !googleClientId ||
      googleSdkStatus !== "ready" ||
      !googleButtonElement ||
      !googleButtonWidth
    ) {
      return;
    }

    const googleAccountsId = window.google?.accounts?.id;
    if (!googleAccountsId) return;

    let failureTimer: number | null = null;

    try {
      clearGoogleButtonContainer(googleButtonElement);
      initializeGoogleIdentity(googleClientId, handleGoogleCredential);
    } catch (error) {
      console.error("Google sign-in initialization failed", error);
      clearGoogleButtonContainer(googleButtonElement);
      failureTimer = window.setTimeout(() => {
        setGoogleSdkStatus("failed");
        setGoogleSdkError(GOOGLE_SDK_INIT_ERROR);
      }, 0);
      return () => {
        if (failureTimer !== null) {
          window.clearTimeout(failureTimer);
        }
      };
    }

    try {
      googleAccountsId.renderButton(googleButtonElement, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: googleButtonWidth,
        click_listener: schedulePopupNotice,
      });
    } catch (error) {
      console.error("Google sign-in render failed", error);
      clearGoogleButtonContainer(googleButtonElement);
      failureTimer = window.setTimeout(() => {
        setGoogleSdkStatus("failed");
        setGoogleSdkError(GOOGLE_BUTTON_RENDER_ERROR);
      }, 0);
    }

    return () => {
      if (failureTimer !== null) {
        window.clearTimeout(failureTimer);
      }

      if (activeGoogleCredentialHandler === handleGoogleCredential) {
        activeGoogleCredentialHandler = null;
      }
      clearPopupNoticeTimer();
      clearGoogleButtonContainer(googleButtonElement);
    };
  }, [
    clearPopupNoticeTimer,
    googleClientId,
    googleButtonWidth,
    googleSdkStatus,
    handleGoogleCredential,
    schedulePopupNotice,
  ]);

  useEffect(() => {
    return () => {
      clearPopupNoticeTimer();
      window.google?.accounts?.id?.cancel?.();
    };
  }, [clearPopupNoticeTimer]);

  const busy = loading || redirecting || googleLoading;
  const googleSdkLoading = googleSdkStatus === "loading";
  const googleSdkFailed = googleSdkStatus === "failed";

  return (
    <>
      {googleClientId && (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => {
            markGoogleSdkReady();
          }}
          onReady={() => {
            markGoogleSdkReady();
          }}
          onError={() => {
            markGoogleSdkFailed();
          }}
        />
      )}
      <PublicHeader />
      <main className="bg-[linear-gradient(180deg,#f6f8f5_0%,#f3f8f5_100%)] px-3 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100dvh-9rem)] w-full max-w-6xl items-center gap-3 py-1 sm:py-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:gap-x-8 lg:gap-y-3">
          <section className="min-w-0 rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,#ecfdf5_0%,#f7faf8_100%)] p-3 shadow-[var(--shadow-subtle)] sm:p-4 lg:col-start-1 lg:row-start-1 lg:p-5">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">Food Rescue Marketplace</span>
            </div>
            <div className="mt-4 max-w-xl space-y-3">
              <h1 className="text-3xl font-semibold leading-[1.1] tracking-[-0.04em] text-zinc-950 sm:text-4xl">
                Good food. Better prices. Near you.
              </h1>
              <p className="text-sm leading-6 text-zinc-700 sm:text-base">
                Discover fresh food available today from local restaurants and cafes. Reserve at a better price and pick it up nearby.
              </p>
            </div>
          </section>

          <section className="w-full min-w-0 space-y-3 rounded-2xl border border-emerald-200 bg-[linear-gradient(180deg,#ffffff_0%,#f6fbf8_100%)] p-3 shadow-[0_10px_28px_rgba(22,132,91,0.08)] sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:p-6">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950 sm:text-2xl">
                Welcome to FoodForAll
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Continue with Google to discover and reserve fresh food nearby.
              </p>
            </div>

            {(authError || authSuccess || sessionNotice) && (
              <div aria-live="polite" className="space-y-2">
                {sessionNotice && (
                  <OperationalFeedbackBlock title={sessionNotice} tone="warning" />
                )}

                {authError && (
                  <OperationalFeedbackBlock title={authError} tone="error" />
                )}

                {authSuccess && (
                  <OperationalFeedbackBlock title={authSuccess} tone="success" />
                )}
              </div>
            )}

            {googleClientId ? (
              <div
                className={`flex min-h-11 min-w-0 justify-center ${
                  busy ? "pointer-events-none opacity-60" : ""
                }`}
                aria-busy={googleLoading || googleSdkLoading}
              >
                {googleSdkStatus === "ready" && (
                  <div
                    ref={googleButtonRef}
                    className="flex min-h-11 w-full min-w-0 justify-center overflow-hidden"
                  >
                    {!googleButtonWidth && (
                      <div className="flex h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-600">
                        Preparing Google sign-in...
                      </div>
                    )}
                  </div>
                )}
                {googleSdkLoading && (
                  <div className="flex h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-600">
                    Loading Google sign-in...
                  </div>
                )}
                {googleSdkFailed && (
                  <button
                    type="button"
                    disabled
                    className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-100 px-4 text-sm font-medium text-zinc-500"
                  >
                    Continue with Google
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled
                  className="w-full rounded-md border border-zinc-300 bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-500"
                >
                  Continue with Google
                </button>
                <p className="text-sm text-red-700">
                  Google sign-in is not configured for this environment.
                </p>
              </div>
            )}

            {googleClientId && (googleSdkError || googlePopupNotice) && (
              <div aria-live="polite" className="space-y-2">
                {googleSdkError && (
                  <OperationalFeedbackBlock title={googleSdkError} tone="error" />
                )}
                {googlePopupNotice && (
                  <OperationalFeedbackBlock title={googlePopupNotice} tone="warning" />
                )}
              </div>
            )}

            <p className="text-sm leading-6 text-zinc-600">
              You will add your contact phone number during profile setup.
            </p>
            {isVolunteerNgoAuthEnabled() && (
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
                <Link
                  href="/login?role=volunteer"
                  className="text-emerald-700 underline-offset-2 hover:underline"
                >
                  Volunteer login
                </Link>
                <Link
                  href="/login?role=ngo"
                  className="text-emerald-700 underline-offset-2 hover:underline"
                >
                  NGO login
                </Link>
              </div>
            )}
            <div className="rounded-xl border border-emerald-200 bg-[linear-gradient(135deg,#ecfdf5_0%,#f0fdf4_100%)] px-3 py-2 text-xs font-medium leading-5 text-emerald-800">
              Reserve, pay, and collect fresh food through your FoodForAll account.
            </div>
          </section>

          <section className="min-w-0 space-y-2 lg:col-start-1 lg:row-start-2">
            <div className="grid max-w-xl gap-2.5 sm:grid-cols-3 sm:gap-3">
              {[
                {
                  title: "DISCOVER NEARBY",
                  text: "Find fresh food available today.",
                  icon: MapPin,
                  tint: "bg-emerald-100 text-emerald-700 border border-emerald-200",
                },
                {
                  title: "BETTER PRICES",
                  text: "Enjoy good food at lower prices.",
                  icon: BadgeIndianRupee,
                  tint: "bg-amber-100 text-amber-700 border border-amber-200",
                },
                {
                  title: "SIMPLE PICKUP",
                  text: "Reserve, pay, and collect.",
                  icon: Store,
                  tint: "bg-sky-100 text-sky-700 border border-sky-200",
                },
              ].map(({ title, text, icon: Icon, tint }) => (
                <div
                  key={title}
                  className="rounded-xl border border-zinc-200 bg-white p-3 shadow-[var(--shadow-subtle)]"
                >
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    {title}
                  </p>
                  <p className="mt-1 text-xs font-medium leading-5 text-zinc-700">
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
