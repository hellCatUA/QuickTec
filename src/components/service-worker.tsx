"use client";

import * as React from "react";

/**
 * Registers the service worker that keeps the shell usable when the connection
 * drops mid-job. iOS Safari has no Background Sync API, so anything queued only
 * flushes while the PWA is actually open — the offline banner exists to make
 * that visible rather than silent.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration must never break the app; the tech can still
        // work online.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
