"use client";

import type { PrivacyLevel } from "@prisma-client";
import { Camera, Check, Loader2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import * as React from "react";
import { HistoryButton, HistoryPanel, useHistoryOf } from "@/components/profile/history";
import { Avatar, LevelBadge, LevelIcon } from "@/components/profile/parts";
import { Button } from "@/components/ui/button";
import { prepareForUpload } from "@/lib/photo-upload";
import { PICTURE_REASONS } from "@/lib/profile-format";
import { LEVEL_INFO } from "@/lib/profile-privacy";
import { cn } from "@/lib/utils";
import {
  removeOwnPicture,
  restoreOwnPicture,
  setOwnPictureVisibility,
  uploadOwnPicture,
  withdrawOwnRequest,
  type ProfileResult,
} from "./actions";

type Earlier = { id: string; src: string; at: string; source: string };

/**
 * Somebody's own picture, and what they may do with it: choose who sees it,
 * put up a new one — approved by their direct supervisor, or by QuickTec when
 * they have none — take it down, or put back one they had before.
 *
 * All of it lives in a menu under the picture rather than as controls on the
 * page: it is set once and rarely touched, and the page is for the details
 * that do change.
 */
export function PictureCard({
  name,
  src,
  level,
  baseLevel,
  allowChoice,
  pending,
  reviewer,
  earlier,
  children,
}: {
  name: string;
  src: string | null;
  /** Where the picture sits now. */
  level: PrivacyLevel;
  /** The company's level for pictures. */
  baseLevel: PrivacyLevel;
  /** Whether the person may keep a Public picture to the company. */
  allowChoice: boolean;
  pending: { id: string; src: string } | null;
  /** Their direct supervisor, who approves a new one; null when QuickTec does. */
  reviewer: string | null;
  /** Pictures they had before, to put back. */
  earlier: Earlier[];
  children?: React.ReactNode;
}) {
  const userId = useHistoryOf();
  const [open, setOpen] = React.useState(false);
  // One thing open under the picture at a time.
  const [panel, setPanel] = React.useState<"reason" | "remove" | "restore" | "history" | null>(null);
  const [reason, setReason] = React.useState<string>("");
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
    startTransition(async () => {
      const answer = await work();
      setResult(answer);
      if (answer.ok) setPanel(null);
    });
  }

  function send(chosen: File) {
    run(async () => {
      const prepared = await prepareForUpload(chosen);
      const formData = new FormData();
      formData.set("picture", prepared.file);
      if (!src) formData.set("reason", reason);
      return uploadOwnPicture(formData);
    });
  }

  function choose(next: typeof panel) {
    setOpen(false);
    setResult(null);
    setPanel((was) => (was === next ? null : next));
  }

  // Public, or kept to the company — where pictures are Public and the
  // company lets them choose. Otherwise the company's level is the only one.
  const choices: PrivacyLevel[] =
    baseLevel === "PUBLIC" && allowChoice ? ["PUBLIC", "FEDERATED"] : [baseLevel];

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar src={src} name={name} size={112} />
      {children}

      <div ref={root} className="relative flex w-full items-center gap-2 border-t border-border pt-3 text-left">
        <span className="text-sm font-medium">Profile picture</span>
        <LevelBadge level={level} iconOnly />
        {userId ? (
          <HistoryButton
            label="Profile picture"
            open={panel === "history"}
            onToggle={() => choose("history")}
          />
        ) : null}
        <button
          type="button"
          aria-label="Picture settings"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((was) => !was)}
          className="ml-auto flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </button>

        {open ? (
          <div
            role="menu"
            aria-label="Picture settings"
            // Opens upwards: below the picture on a phone is the tab bar,
            // which it ran under.
            className="absolute bottom-full right-0 z-50 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-surface-raised py-1 shadow-lg"
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
                onClick={() => run(() => setOwnPictureVisibility(choice))}
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
            <MenuItem
              icon={<Camera className="size-4 text-muted-foreground" />}
              onClick={() => {
                if (src || pending) {
                  setOpen(false);
                  file.current?.click();
                } else {
                  // With no picture, the request says why first.
                  choose("reason");
                }
              }}
            >
              {pending ? "Send a different picture" : src ? "Request a new picture" : "Add a picture"}
            </MenuItem>
            {earlier.length > 0 ? (
              <MenuItem
                icon={<RotateCcw className="size-4 text-muted-foreground" />}
                onClick={() => choose("restore")}
              >
                Put back an earlier picture
              </MenuItem>
            ) : null}
            {src ? (
              <MenuItem icon={<Trash2 className="size-4" />} danger onClick={() => choose("remove")}>
                Take my picture down
              </MenuItem>
            ) : null}
            {pending ? (
              <MenuItem danger onClick={() => run(() => withdrawOwnRequest(pending.id))}>
                Withdraw the picture request
              </MenuItem>
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

      {panel === "reason" ? (
        <fieldset className="flex w-full flex-col gap-1 rounded-lg border border-border p-3 text-left">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Why a picture now?</legend>
          {PICTURE_REASONS.map((option) => (
            <label key={option} className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="radio"
                name="picture-reason"
                value={option}
                checked={reason === option}
                onChange={() => setReason(option)}
                className="size-4 accent-primary"
              />
              {option}
            </label>
          ))}
          <div className="mt-1 flex gap-2">
            <Button type="button" size="sm" disabled={!reason || busy} onClick={() => file.current?.click()}>
              <Camera /> Choose a photo
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : null}

      {panel === "remove" ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-left text-sm">
          <p>Take your picture down? It stays among your earlier pictures, to put back.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => run(removeOwnPicture)}>
              Take it down
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {panel === "restore" ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-border p-3 text-left">
          <p className="text-xs text-muted-foreground">Approved once, so it goes back up at once.</p>
          <ul className="flex flex-col gap-2">
            {earlier.map((picture) => (
              <li key={picture.id} className="flex items-center gap-3">
                <Avatar src={picture.src} name={name} size={48} />
                <span className="min-w-0 flex-1 text-xs">
                  <span className="block">{picture.at}</span>
                  <span className="block truncate text-muted-foreground">{picture.source}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(() => restoreOwnPicture(picture.id))}
                >
                  Put back
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {panel === "history" && userId ? (
        <HistoryPanel userId={userId} field="picture" className="w-full text-left" />
      ) : null}

      {pending ? (
        <div className="flex w-full items-center gap-3 rounded-lg bg-warning/10 p-2.5 text-left text-xs text-warning">
          <Avatar src={pending.src} name={name} size={40} />
          <span>New picture waiting on {reviewer ?? "a manager"}. It shows once approved.</span>
        </div>
      ) : src || panel ? null : (
        <p className="w-full text-left text-xs text-muted-foreground">
          {reviewer
            ? `No picture. A new one goes to ${reviewer} for approval.`
            : "No picture. A new one is set at once — there is no supervisor to approve it."}
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

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-muted",
        danger && "text-danger",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
