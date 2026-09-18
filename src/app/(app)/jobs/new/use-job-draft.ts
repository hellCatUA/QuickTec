"use client";

import * as React from "react";
import type { JobDraftPayload } from "@/lib/job-draft";
import { saveJobDraft } from "../actions";

export type DraftState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "failed" };

/**
 * Keeps the form on the server while somebody fills it in.
 *
 * Debounced rather than saved per keystroke: typing an address is thirty
 * keystrokes and one piece of information, and thirty round trips to record it
 * is thirty chances to be the reason the page feels slow.
 *
 * The first render is skipped. Restoring a draft sets state, which looks
 * exactly like typing from here, and saving it straight back would rewrite the
 * row with what it already holds every time the page opens.
 *
 * A failed save is remembered but not shouted about. It retries on the next
 * change, which is usually a second away.
 */
export function useJobDraft(
  payload: JobDraftPayload,
  { enabled }: { enabled: boolean },
): DraftState {
  const [state, setState] = React.useState<DraftState>({ kind: "idle" });
  const first = React.useRef(true);

  // The payload is rebuilt on every render, so comparing it by identity would
  // save constantly. Its serialised form is what actually changed.
  const serialised = JSON.stringify(payload);

  React.useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }

    let cancelled = false;
    setState({ kind: "saving" });

    const timer = setTimeout(() => {
      void saveJobDraft(JSON.parse(serialised)).then((result) => {
        if (cancelled) return;
        setState(
          result.ok
            ? { kind: "saved", at: result.savedAt ? new Date(result.savedAt) : new Date() }
            : { kind: "failed" },
        );
      });
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [serialised, enabled]);

  return state;
}

/** "Draft saved 12:04", or what is happening instead. */
export function draftLabel(state: DraftState): string | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "saving":
      return "Saving…";
    case "saved":
      return `Draft saved ${state.at.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    case "failed":
      // Says what is true — the typing is still on screen — rather than
      // implying it has been lost.
      return "Not saved yet; still here on the page";
  }
}
