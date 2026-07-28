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

export function ThemeToggle({ className }: { className?: string }) {
  // Dark is the product default, not the OS default.
  const [preference, setPreference] = React.useState<ThemePreference>("dark");

  React.useEffect(() => {
    const stored = localStorage.getItem(
      THEME_STORAGE_KEY,
    ) as ThemePreference | null;
    if (stored) setPreference(stored);
  }, []);

  React.useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  function choose(next: ThemePreference) {
    setPreference(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
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
