type CashfreeMode = "sandbox" | "production";
type CashfreeRedirectTarget = "_self" | "_blank" | "_top" | "_modal" | HTMLElement;

export type CashfreeCheckoutResult = {
  error?: {
    code?: string;
    message?: string;
  };
  order?: {
    order_id?: string;
    order_status?: string;
  };
  paymentDetails?: unknown;
};

type CashfreeCheckoutOptions = {
  paymentSessionId: string;
  redirectTarget?: CashfreeRedirectTarget;
};

type CashfreeInstance = {
  checkout: (
    options: CashfreeCheckoutOptions
  ) => Promise<CashfreeCheckoutResult | undefined>;
};

type CashfreeFactory = (options: { mode: CashfreeMode }) => CashfreeInstance;

declare global {
  interface Window {
    Cashfree?: CashfreeFactory;
  }
}

const SDK_SCRIPT_ID = "cashfree-js-sdk";
const SDK_SRC = "https://sdk.cashfree.com/js/v3/cashfree.js";

let sdkPromise: Promise<CashfreeFactory> | null = null;

function getCashfreeMode(): CashfreeMode {
  return process.env.NEXT_PUBLIC_CASHFREE_MODE === "production"
    ? "production"
    : "sandbox";
}

function getExistingScript() {
  return document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null;
}

export function loadCashfreeSdk(): Promise<CashfreeFactory> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Cashfree checkout is only available in the browser."));
  }

  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<CashfreeFactory>((resolve, reject) => {
    const existingScript = getExistingScript();
    const script = existingScript ?? document.createElement("script");

    script.id = SDK_SCRIPT_ID;
    script.src = SDK_SRC;
    script.async = true;

    script.addEventListener("load", () => {
      if (window.Cashfree) {
        resolve(window.Cashfree);
        return;
      }

      reject(new Error("Cashfree SDK loaded without exposing checkout."));
    });

    script.addEventListener("error", () => {
      sdkPromise = null;
      reject(new Error("Unable to load Cashfree checkout. Please try again."));
    });

    if (!existingScript) {
      document.head.appendChild(script);
    }
  });

  return sdkPromise;
}

export async function openCashfreeCheckout(
  options: CashfreeCheckoutOptions
): Promise<CashfreeCheckoutResult | undefined> {
  const Cashfree = await loadCashfreeSdk();
  const cashfree = Cashfree({ mode: getCashfreeMode() });

  return cashfree.checkout({
    redirectTarget: "_modal",
    ...options,
  });
}
