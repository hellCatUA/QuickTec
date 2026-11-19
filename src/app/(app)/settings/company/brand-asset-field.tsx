"use client";

import { Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import {
  BRAND_ASSET_ACCEPT,
  BRAND_ASSET_MAX_BYTES,
  BRAND_SCALE_DEFAULT,
  BRAND_SCALE_MAX,
  BRAND_SCALE_MIN,
  BRAND_SCALE_STEP,
  brandSize,
  type BrandAsset,
} from "@/lib/brand";
import { cn } from "@/lib/utils";
import {
  removeBrandAsset,
  uploadBrandAsset,
  type BrandAssetResult,
} from "./brand-actions";

/** Where the artwork is drawn, so the readout can name real numbers. */
type Surface = { base: number; where: string };

/**
 * A brand asset: the file, its size knob where it has one, and a true-size
 * preview.
 *
 * The file is uploaded the moment it is picked and is live from then on; the
 * scale is part of the company form and saved with it. The preview is the
 * reason this is a component rather than two inputs. A scale you cannot see is
 * a guess: you would save, reload, squint at the header, come back and move it
 * again. Here the artwork is drawn at exactly the pixel size the app will use,
 * and it is the file the server kept — an SVG already turned into the PNG every
 * page will be served — not the one that was picked.
 *
 * Both themes, side by side, because a logo is not one picture. The company
 * logo is inverted on the light theme, and a file that looks right on dark can
 * come back as a hole in the page on light — worth finding out here rather
 * than from whoever switched themes.
 */
export function BrandAssetField({
  asset,
  label,
  hint,
  src,
  scale: scaleField,
  surfaces,
  shape,
  invertsOnLight,
}: {
  asset: BrandAsset;
  label: string;
  hint: string;
  /** Where the current file is served, or null when none is uploaded. */
  src: string | null;
  /** The size knob, for the assets that have one; the app icon does not. */
  scale?: { name: string; defaultValue: number };
  /**
   * Where it is drawn. With a scale, the first is what the preview draws and
   * all of them are named in the readout; without one, each is drawn.
   */
  surfaces: Surface[];
  shape: "square" | "wide";
  invertsOnLight: boolean;
}) {
  const [scale, setScale] = React.useState(
    scaleField?.defaultValue ?? BRAND_SCALE_DEFAULT,
  );
  // What this field last did, until the page brings the same back. The action
  // revalidates the page, so `src` follows on its own; this only bridges the
  // moment between the answer and the new page, and steps aside as soon as a
  // different `src` arrives.
  const [shown, setShown] = React.useState<{ src: string | null } | null>(null);
  const [seenSrc, setSeenSrc] = React.useState(src);
  if (seenSrc !== src) {
    setSeenSrc(src);
    setShown(null);
  }
  const current = shown ? shown.src : src;

  const [busy, startTransition] = React.useTransition();
  const [doing, setDoing] = React.useState<"Uploading…" | "Removing…">("Uploading…");
  const [message, setMessage] = React.useState<
    { tone: "error" | "notice"; text: string } | null
  >(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const pickerId = `brand-${asset}-file`;
  const buttonId = `brand-${asset}-upload`;
  const titleId = `brand-${asset}-title`;
  const what = label.toLowerCase();

  // The button pressed is disabled while it works, and Remove is gone once it
  // has, and either drops the keyboard's place to the top of the page. Put
  // back on the upload button — but only when it was lost, not taken from
  // whatever somebody moved on to meanwhile.
  const refocus = React.useRef(false);
  React.useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    // By id: the shared Button takes no ref.
    if (!active || active === document.body) document.getElementById(buttonId)?.focus();
  }, [busy, buttonId]);

  function run(
    work: () => Promise<BrandAssetResult>,
    doingNow: "Uploading…" | "Removing…",
    done: string,
  ) {
    setMessage(null);
    setDoing(doingNow);
    refocus.current = true;
    startTransition(async () => {
      let answer: BrandAssetResult;
      try {
        answer = await work();
      } catch {
        // A thrown action — a lost connection, a server that fell over —
        // reaches the browser as a bare rejection. Said plainly instead.
        // (Signed out and not allowed are answers, not throws: see
        // brand-actions.ts.)
        answer = {
          ok: false,
          error: "That did not reach the server. Check the connection and try again.",
        };
      }
      if (answer.ok) {
        setShown({ src: answer.src });
        // Always something, so a screen reader hears that it worked: the
        // previews are pictures with nothing to say.
        setMessage({ tone: "notice", text: answer.notice ?? done });
      } else {
        setMessage({ tone: "error", text: answer.error });
      }
    });
  }

  function send(file: File) {
    // Said here rather than after sending ten megabytes over a site's LTE to
    // be told the same thing.
    if (file.size > BRAND_ASSET_MAX_BYTES) {
      setMessage({ tone: "error", text: "That file is too large. Pick one under 10 MB." });
      return;
    }
    run(
      () => {
        const formData = new FormData();
        formData.set("file", file);
        return uploadBrandAsset(asset, formData);
      },
      "Uploading…",
      "Uploaded.",
    );
  }

  function remove() {
    // Asked, like every other button here that deletes a stored file: it comes
    // off every page at once, it sits a thumb's width from Replace, and the
    // only way back is the original file, which may not be on this phone.
    if (
      !window.confirm(
        `Remove the ${what}? It comes off every page, and the file is deleted.`,
      )
    ) {
      return;
    }
    run(() => removeBrandAsset(asset), "Removing…", "Removed.");
  }

  const previewPx = brandSize(surfaces[0].base, scale);
  const sizes = scaleField ? [previewPx] : surfaces.map((one) => one.base);

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-col gap-1.5">
        {/* Not a <label for> the button: a button takes its name from a label
            pointed at it, over its own words, so a screen reader said
            "Company logo, button" and never "Upload file" or "Replace file".
            The title names the group instead, and each button says what it
            does to which asset. */}
        <Label id={titleId}>{label}</Label>
        <div
          role="group"
          aria-labelledby={titleId}
          className="flex flex-wrap items-center gap-2"
        >
          {/* No name: the file never rides along with the company form. */}
          <input
            ref={picker}
            id={pickerId}
            type="file"
            accept={BRAND_ASSET_ACCEPT}
            className="hidden"
            aria-label={`Choose a file for the ${what}`}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              // Cleared at once, so picking the same file again — after fixing
              // it, or after a failed upload — is still a change.
              event.target.value = "";
              if (chosen) send(chosen);
            }}
          />
          <Button
            id={buttonId}
            type="button"
            variant="secondary"
            disabled={busy}
            aria-label={`${current ? "Replace file" : "Upload file"} for the ${what}`}
            onClick={() => picker.current?.click()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {current ? "Replace file" : "Upload file"}
          </Button>
          {current ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              aria-label={`Remove the ${what}`}
              onClick={remove}
              className="text-danger"
            >
              <Trash2 />
              Remove
            </Button>
          ) : null}
        </div>
        <p role="status" aria-live="polite" className="text-xs">
          {busy ? (
            <span className="text-muted-foreground">{doing}</span>
          ) : message ? (
            <span
              className={message.tone === "error" ? "text-danger" : "text-muted-foreground"}
            >
              {message.text}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
        {scaleField ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={scaleField.name}>Scale</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums">{scale}%</span>
                {scale === BRAND_SCALE_DEFAULT ? null : (
                  <button
                    type="button"
                    onClick={() => setScale(BRAND_SCALE_DEFAULT)}
                    className="flex min-h-11 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-surface hover:text-foreground"
                  >
                    <RotateCcw className="size-3" />
                    Reset
                  </button>
                )}
              </div>
            </div>

            <input
              id={scaleField.name}
              name={scaleField.name}
              type="range"
              min={BRAND_SCALE_MIN}
              max={BRAND_SCALE_MAX}
              step={BRAND_SCALE_STEP}
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
              className="h-6 w-full accent-[var(--color-primary)]"
            />
          </>
        ) : null}

        <p className="text-xs tabular-nums text-muted-foreground">
          {surfaces
            .map(
              (one) =>
                `${scaleField ? brandSize(one.base, scale) : one.base}px ${one.where}`,
            )
            .join(" · ")}
        </p>

        {/* `.dark` and `.light` redeclare the theme's custom properties, so a
            tile wearing one is that theme's real surface rather than a colour
            copied out of globals.css and left to rot. The inversion is applied
            by hand: the `light:` variant matches on an ancestor, and on a page
            already rendered light it would fire inside the dark tile too. */}
        <div className="grid grid-cols-2 gap-2">
          <PreviewTile
            theme="dark"
            caption="Dark theme"
            src={current}
            sizes={sizes}
            shape={shape}
            invert={false}
          />
          <PreviewTile
            theme="light"
            caption={invertsOnLight ? "Light theme · inverted" : "Light theme"}
            src={current}
            sizes={sizes}
            shape={shape}
            invert={invertsOnLight}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewTile({
  theme,
  caption,
  src,
  sizes,
  shape,
  invert,
}: {
  theme: "dark" | "light";
  caption: string;
  src: string | null;
  sizes: number[];
  shape: "square" | "wide";
  invert: boolean;
}) {
  return (
    <div
      className={cn(
        theme,
        "flex flex-col items-center gap-2 overflow-hidden rounded-lg border border-border bg-surface p-3",
      )}
    >
      <div className="flex min-h-20 max-w-full items-center justify-center gap-3">
        {src ? (
          sizes.map((px) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={px}
              src={src}
              alt=""
              style={
                shape === "square" ? { width: px, height: px } : { height: px }
              }
              className={cn("max-w-full object-contain", invert && "invert")}
            />
          ))
        ) : (
          <span className="text-xs text-muted-foreground">Nothing uploaded</span>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground">{caption}</span>
    </div>
  );
}
