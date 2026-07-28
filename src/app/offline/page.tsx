import { CloudOff } from "lucide-react";

export const metadata = { title: "Offline" };

// Served by the service worker when a navigation fails. Must not depend on
// anything server-rendered.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <CloudOff className="size-10 text-warning" />
      <h1 className="text-lg font-semibold">You&rsquo;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        QuickTec could not reach the server. Anything you already typed on this
        device is kept and will sync once you have a signal again.
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        This app is only reachable over the company Tailscale network — if you
        are online but still seeing this, check that Tailscale is connected.
      </p>
    </div>
  );
}
