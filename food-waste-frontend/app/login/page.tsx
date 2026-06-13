"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { PublicFooter } from "@/components/public/PublicSite";
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
  "Google sign-in could not load. Please refresh the page or try again later.";

type GoogleSdkStatus = "loading" | "ready" | "failed";

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

  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const authError = useAuthStore((state) => state.authError);
  const authSuccess = useAuthStore((state) => state.authSuccess);
  const googleLogin = useAuthStore((state) => state.googleLogin);
  const clearMessages = useAuthStore((state) => state.clearMessages);

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
        !response.credential ||
        googleAuthBusyRef.current ||
        redirectingRef.current
      ) {
        return;
      }

      clearMessages();
      setSessionNotice("");
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
    if (!googleClientId || googleSdkStatus !== "ready" || !googleButtonElement) {
      return;
    }

    const googleAccountsId = window.google?.accounts?.id;
    if (!googleAccountsId) return;

    let failureTimer: number | null = null;

    try {
      googleButtonElement.replaceChildren();
      googleAccountsId.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });
      googleAccountsId.renderButton(googleButtonElement, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: 320,
      });
    } catch (error) {
      console.error("Google sign-in render failed", error);
      googleButtonElement.replaceChildren();
      failureTimer = window.setTimeout(() => {
        setGoogleSdkStatus("failed");
        setGoogleSdkError(GOOGLE_SDK_LOAD_ERROR);
      }, 0);
    }

    return () => {
      if (failureTimer !== null) {
        window.clearTimeout(failureTimer);
      }

      googleButtonElement.replaceChildren();
    };
  }, [googleClientId, googleSdkStatus, handleGoogleCredential]);

  useEffect(() => {
    const googleButtonElement = googleButtonRef.current;

    return () => {
      googleButtonElement?.replaceChildren();
      window.google?.accounts?.id?.cancel?.();
    };
  }, []);

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
      <main className="min-h-screen bg-zinc-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
          <section className="space-y-6">
            <div className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Food rescue platform
            </div>
            <div className="max-w-2xl space-y-4">
              <h1 className="text-4xl font-semibold text-zinc-950 sm:text-5xl">
                FoodForAll
              </h1>
              <p className="text-lg leading-8 text-zinc-700">
                Connect restaurants, NGOs, volunteers and communities to rescue
                surplus food before it goes to waste.
              </p>
            </div>
            <ul className="grid max-w-2xl gap-3 text-sm font-medium text-zinc-700 sm:grid-cols-3 lg:grid-cols-1">
              {[
                "Reduce food waste.",
                "Support communities.",
                "Create measurable impact.",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="w-full space-y-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
            <div>
              <h2 className="text-2xl font-semibold text-zinc-950">
                Sign in to FoodForAll
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Continue with Google to access your account.
              </p>
            </div>

            {(authError || authSuccess || sessionNotice) && (
              <div aria-live="polite" className="space-y-2">
                {sessionNotice && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {sessionNotice}
                  </p>
                )}

                {authError && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {authError}
                  </p>
                )}

                {authSuccess && (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {authSuccess}
                  </p>
                )}
              </div>
            )}

            {googleClientId ? (
              <div
                ref={googleButtonRef}
                className={`flex min-h-11 justify-center ${
                  busy ? "pointer-events-none opacity-60" : ""
                }`}
                aria-busy={googleLoading || googleSdkLoading}
              >
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

            {googleClientId && googleSdkError && (
              <p className="text-sm text-red-700">{googleSdkError}</p>
            )}

            <p className="text-sm leading-6 text-zinc-600">
              You will add your contact phone number during profile setup.
            </p>
          </section>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
