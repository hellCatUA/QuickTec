"use client";

import { CloudOff } from "lucide-react";
import * as React from "react";

/**
 * Sites are basements and stockrooms; the connection drops mid-form all the
 * time. `navigator.onLine` only reports whether a network interface exists, so
 * it is backed up with a cheap same-origin ping — a captive tablet hotspot with
 * no route out still reports "online" otherwise.
 */
export function ConnectionStatus() {
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    function update(value: boolean) {
      if (!cancelled) setOnline(value);
    }

    async function probe() {
      if (!navigator.onLine) return update(false);
      try {
        const response = await fetch("/api/health", {
          method: "HEAD",
          cache: "no-store",
        });
        update(response.ok);
      } catch {
        update(false);
      }
    }

    update(navigator.onLine);
    const onOnline = () => void probe();
    const onOffline = () => update(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = setInterval(probe, 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-warning px-3 py-1.5 text-xs font-medium text-warning-foreground"
    >
      <CloudOff className="size-3.5" />
      Offline — your entries are saved on this device and will sync when the
      connection returns.
    </div>
  );
}
