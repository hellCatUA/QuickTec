"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import * as React from "react";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * A textarea that saves itself.
 *
 * Written for a tech typing in a stockroom with one bar of signal: the text
 * stays in local state and is never overwritten from the server while they are
 * working, a failed save is retried with backoff rather than lost, and a
 * pending save is flushed the moment the connection returns or the page is
 * hidden. The status line exists so nobody has to guess whether their work is
 * safe.
 */
export function AutosaveText({
  initialValue,
  save,
  label,
  hint,
  rows = 5,
  placeholder,
  disabled,
  debounceMs = 1200,
  className,
}: {
  initialValue: string;
  save: (value: string) => Promise<{ ok: boolean; error?: string }>;
  label?: string;
  hint?: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  debounceMs?: number;
  className?: string;
}) {
  const [value, setValue] = React.useState(initialValue);
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = React.useRef(0);
  // What the server is known to hold. Compared against the live value so a
  // flush can skip work that is already saved.
  const savedValue = React.useRef(initialValue);
  const inFlight = React.useRef(false);

  const flush = React.useCallback(
    async (next: string) => {
      if (inFlight.current || next === savedValue.current) return;

      inFlight.current = true;
      setStatus("saving");

      try {
        const result = await save(next);
        if (result.ok) {
          savedValue.current = next;
          retries.current = 0;
          setError(null);
          setStatus("saved");
        } else {
          setError(result.error ?? "Could not save");
          setStatus("error");
        }
      } catch {
        // Almost always a dropped connection. Back off and try again rather
        // than telling the tech their work is gone.
        retries.current = Math.min(retries.current + 1, 5);
        setError("No connection — will retry");
        setStatus("error");
        timer.current = setTimeout(
          () => void flush(next),
          1000 * 2 ** retries.current,
        );
      } finally {
        inFlight.current = false;
      }
    },
    [save],
  );

  function onChange(next: string) {
    setValue(next);
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(next), debounceMs);
  }

  // Anything that might be the last moment before the app is suspended or the
  // signal goes: get the current text to the server now.
  React.useEffect(() => {
    const latest = () => value;

    function flushNow() {
      if (timer.current) clearTimeout(timer.current);
      void flush(latest());
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") flushNow();
    }

    window.addEventListener("online", flushNow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);

    return () => {
      window.removeEventListener("online", flushNow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
    };
  }, [flush, value]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <StatusLine status={status} error={error} />
        </div>
      ) : null}

      <Textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          void flush(value);
        }}
      />

      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {!label ? <StatusLine status={status} error={error} /> : null}
    </div>
  );
}

function StatusLine({ status, error }: { status: Status; error: string | null }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Saving
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-success">
        <Check className="size-3" /> Saved
      </span>
    );
  }
  if (status === "dirty") {
    return (
      <span className="text-xs text-muted-foreground">Unsaved changes</span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-xs text-warning">
        <AlertCircle className="size-3" /> {error}
      </span>
    );
  }
  return null;
}
