"use client";

import * as React from "react";

/**
 * Which of the two things went wrong.
 *
 * "Offline" and "online but cannot reach QuickTec" are different problems with
 * different answers, and the second is by far the more common one here: the
 * app's address only resolves to somewhere reachable from the company VPN, so
 * a phone with four bars of signal and the VPN switched off fails exactly like
 * a phone in a lift. Told "you're offline", a person checks their signal —
 * which is fine — and concludes the app is broken.
 *
 * The browser already knows the difference, so it is asked rather than guessed
 * at. Rendered on the client because the server cannot answer this: by the time
 * this page is on screen there is no server in the conversation.
 */
export function Reachability() {
  // Starts as the offline reading so that the first paint matches the server's
  // markup; the effect corrects it immediately if there is a connection.
  const [online, setOnline] = React.useState(false);

  React.useEffect(() => {
    const read = () => setOnline(navigator.onLine);
    read();
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    return () => {
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
    };
  }, []);

  if (online) {
    return (
      <>
        <h1 className="text-lg font-semibold">Can&rsquo;t reach QuickTec</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your device is online, so this is almost certainly the VPN. QuickTec
          is only reachable over the company VPN — connect it and try again.
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Anything you already typed on this device is kept and will sync once
          you are back on.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-lg font-semibold">You&rsquo;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        QuickTec could not reach the server. Anything you already typed on this
        device is kept and will sync once you have a signal again.
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        This app is only reachable over the company VPN — if you are online but
        still seeing this, check that your VPN is connected.
      </p>
    </>
  );
}
