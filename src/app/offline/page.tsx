import { CloudOff } from "lucide-react";
import { Reachability } from "./reachability";

export const metadata = { title: "Offline" };

// Served by the service worker when a navigation fails. Must not depend on
// anything server-rendered.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <CloudOff className="size-10 text-warning" />
      <Reachability />
    </div>
  );
}
