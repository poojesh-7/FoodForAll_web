"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { CheckCircle2, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";
import { PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import { getPublicGoogleClientId } from "@/lib/env";
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
        finishAuthRedirect(result.user);
      }
    },
    [
      clearMessages,
      finishAuthRedirect,
      googleLogin,
      clearPopupNoticeTimer,
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
      <main className="bg-zinc-50 px-3 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100dvh-8rem)] w-full max-w-6xl items-center gap-5 py-2 sm:py-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:gap-x-10 lg:gap-y-5">
          <section className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
            <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase text-emerald-700">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">Food rescue platform</span>
            </div>
            <div className="max-w-2xl space-y-4">
              <h1 className="text-3xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
                Sign in to rescue fresh food nearby.
              </h1>
            </div>
          </section>

          <section className="w-full min-w-0 space-y-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950 sm:text-2xl">
                Sign in to FoodForAll
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Continue with Google to access your account.
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
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-800">
              Reserve, pay, and collect fresh surplus food through your
              FoodForAll account.
            </div>
          </section>

          <section className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-2">
            <div className="max-w-2xl space-y-4">
              <p className="text-base leading-7 text-zinc-700 sm:text-lg sm:leading-8">
                FoodForAll connects people with surplus meals from trusted local
                providers, so good food can be reserved, paid for, and collected
                before it goes to waste.
              </p>
            </div>
            <ul className="grid max-w-2xl gap-3 text-sm font-medium text-zinc-700 sm:grid-cols-3 lg:grid-cols-1">
              {[
                "Discover affordable food.",
                "Reserve with confidence.",
                "Support local impact.",
              ].map((item) => (
                <li
                  key={item}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 shadow-sm"
                >
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-emerald-700"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
            <div className="grid max-w-xl gap-3 text-sm text-zinc-600 sm:grid-cols-2">
              <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
                <MapPin className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                <p className="mt-2 font-semibold text-zinc-950">
                  Nearby availability
                </p>
                <p className="mt-1 leading-6">
                  Find pickups from restaurants and providers around you.
                </p>
              </div>
              <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
                <ShieldCheck
                  className="h-5 w-5 text-emerald-700"
                  aria-hidden="true"
                />
                <p className="mt-2 font-semibold text-zinc-950">
                  Trusted access
                </p>
                <p className="mt-1 leading-6">
                  Continue with Google to enter the same secure account flow.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
