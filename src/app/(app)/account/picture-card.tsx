"use client";

import type { PrivacyLevel } from "@prisma-client";
import { Camera, Check, History, Loader2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Avatar, LevelBadge, LevelIcon } from "@/components/profile/parts";
import { prepareForUpload } from "@/lib/photo-upload";
import { LEVEL_INFO } from "@/lib/profile-privacy";
import { cn } from "@/lib/utils";
import {
  setOwnPictureVisibility,
  uploadOwnPicture,
  withdrawOwnRequest,
  type ProfileResult,
} from "./actions";

/**
 * Somebody's own picture, and the two things they may do with it: choose who
 * sees it, and ask for a new one.
 *
 * Both live in a menu under the picture rather than as controls on the page:
 * they are set once and rarely touched, and the page is for the details that
 * do change.
 */
export function PictureCard({
  name,
  src,
  level,
  baseLevel,
  allowPublic,
  pending,
  reviewer,
  children,
}: {
  name: string;
  src: string | null;
  /** Where the picture sits now. */
  level: PrivacyLevel;
  /** The company's level for pictures — the other choice beside Public. */
  baseLevel: PrivacyLevel;
  allowPublic: boolean;
  pending: { id: string; src: string } | null;
  reviewer: string | null;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<ProfileResult | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const file = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function run(work: () => Promise<ProfileResult>) {
    setOpen(false);
    startTransition(async () => setResult(await work()));
  }

  function send(chosen: File) {
    run(async () => {
      const prepared = await prepareForUpload(chosen);
      const formData = new FormData();
      formData.set("picture", prepared.file);
      return uploadOwnPicture(formData);
    });
  }

  const choices: PrivacyLevel[] =
    baseLevel === "PUBLIC" ? ["PUBLIC"] : allowPublic ? [baseLevel, "PUBLIC"] : [baseLevel];

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar src={src} name={name} size={112} />
      {children}

      <div ref={root} className="relative flex w-full items-center gap-2 border-t border-border pt-3 text-left">
        <span className="text-sm font-medium">Profile picture</span>
        <LevelBadge level={level} iconOnly />
        <Link
          href="?history=picture#history"
          scroll={false}
          aria-label="History of profile picture"
          title="History"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <History className="size-4" />
        </Link>
        <button
          type="button"
          aria-label="Picture settings"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((was) => !was)}
          className="ml-auto flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </button>

        {open ? (
          <div
            role="menu"
            aria-label="Picture settings"
            className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface-raised py-1 shadow-lg"
          >
            <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Who sees your picture
            </div>
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                role="menuitemradio"
                aria-checked={level === choice}
                // Stored as Public or not: "not" is whatever the company's level is.
                onClick={() =>
                  run(() => setOwnPictureVisibility(choice === "PUBLIC" ? "PUBLIC" : "FEDERATED"))
                }
                className="flex min-h-11 w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted"
              >
                <LevelIcon level={choice} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{LEVEL_INFO[choice].label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {LEVEL_INFO[choice].description}
                  </span>
                </span>
                {level === choice ? <Check className="mt-0.5 size-4 text-primary" /> : null}
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                file.current?.click();
              }}
              className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-muted"
            >
              <Camera className="size-4 text-muted-foreground" />
              {!src && !pending
                ? "Add a picture"
                : pending
                  ? "Send a different picture"
                  : "Request a new picture"}
            </button>
            {pending ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => run(() => withdrawOwnRequest(pending.id))}
                className="flex min-h-11 w-full items-center px-3 text-left text-sm text-danger hover:bg-muted"
              >
                Withdraw the picture request
              </button>
            ) : null}
          </div>
        ) : null}

        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Choose a picture"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) send(chosen);
          }}
        />
      </div>

      {pending ? (
        <div className="flex w-full items-center gap-3 rounded-lg bg-warning/10 p-2.5 text-left text-xs text-warning">
          <Avatar src={pending.src} name={name} size={40} />
          <span>
            New picture waiting on {reviewer ?? "a manager"}. It shows once approved.
          </span>
        </div>
      ) : src ? null : (
        <p className="w-full text-left text-xs text-muted-foreground">
          No picture yet. Your first one is yours to set; after that a new one goes to your direct
          supervisor.
        </p>
      )}

      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn("w-full text-left text-xs", result.ok ? "text-success" : "text-danger")}
        >
          {result.ok ? (result.message ?? "Saved.") : result.error}
        </p>
      ) : null}
    </div>
  );
}
