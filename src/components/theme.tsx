"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export type ThemePreference = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "quicktec-theme";

/**
 * Runs before first paint so the app never flashes light before switching to
 * dark. Kept as a string because it has to be inlined in <head>.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var prefersLight =
      stored === 'light' ||
      (stored === 'system' &&
        window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.classList.toggle('light', prefersLight);
    document.documentElement.classList.toggle('dark', !prefersLight);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

function applyTheme(preference: ThemePreference) {
  const prefersLight =
    preference === "light" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);

  document.documentElement.classList.toggle("light", prefersLight);
  document.documentElement.classList.toggle("dark", !prefersLight);
}

/**
 * The stored preference read as an external store rather than copied into
 * state: localStorage is written by the inline head script before React exists
 * and by any other tab, so React is the subscriber here, not the owner.
 */
const themeListeners = new Set<() => void>();

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readTheme(): ThemePreference {
  try {
    return (
      (localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null) ??
      "dark"
    );
  } catch {
    return "dark";
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  // Dark is the product default, not the OS default, so it is also what the
  // server renders.
  const preference = React.useSyncExternalStore(
    subscribeTheme,
    readTheme,
    () => "dark" as ThemePreference,
  );

  React.useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  function choose(next: ThemePreference) {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    // localStorage fires no event in the tab that wrote it.
    for (const listener of themeListeners) listener();
  }

  const options: { value: ThemePreference; icon: typeof Sun; label: string }[] =
    [
      { value: "dark", icon: Moon, label: "Dark" },
      { value: "light", icon: Sun, label: "Light" },
      { value: "system", icon: Monitor, label: "System" },
    ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex rounded-lg border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={cn(
            "flex size-9 items-center justify-center rounded-md transition-colors",
            preference === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
