"use client";

import { useEffect } from "react";
import { registerBrowserPushServiceWorker } from "@/lib/browserPush";

export default function BrowserPushInitializer() {
  useEffect(() => {
    void registerBrowserPushServiceWorker();
  }, []);

  return null;
}
