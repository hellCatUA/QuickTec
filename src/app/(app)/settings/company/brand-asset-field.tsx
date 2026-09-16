"use client";

import { RotateCcw } from "lucide-react";
import * as React from "react";
import { Field, Input, Label } from "@/components/ui/field";
import {
  BRAND_SCALE_DEFAULT,
  BRAND_SCALE_MAX,
  BRAND_SCALE_MIN,
  BRAND_SCALE_STEP,
  brandSize,
} from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Where the artwork is drawn, so the readout can name real numbers. */
type Surface = { base: number; where: string };

/**
 * A logo field with its size knob and a true-size preview.
 *
 * The preview is the reason this is a component rather than two inputs. A
 * scale you cannot see is a guess: you would save, reload, squint at the
 * header, come back and move it again. Here the artwork is drawn at exactly
 * the pixel size the app will use, next to the URL that produced it.
 *
 * Both themes, side by side, because a logo is not one picture. The company
 * logo is inverted on the light theme, and a file that looks right on dark can
 * come back as a hole in the page on light — worth finding out here rather
 * than from whoever switched themes.
 */
export function BrandAssetField({
  label,
  hint,
  urlName,
  urlDefault,
  scaleName,
  scaleDefault,
  surfaces,
  shape,
  invertsOnLight,
}: {
  label: string;
  hint: string;
  urlName: string;
  urlDefault: string;
  scaleName: string;
  scaleDefault: number;
  /** First one is what the preview draws. */
  surfaces: Surface[];
  shape: "square" | "wide";
  invertsOnLight: boolean;
}) {
  const [url, setUrl] = React.useState(urlDefault);
  const [scale, setScale] = React.useState(scaleDefault);

  const trimmed = url.trim();
  const previewPx = brandSize(surfaces[0].base, scale);

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <Field label={label} hint={hint} htmlFor={urlName}>
        <Input
          id={urlName}
          name={urlName}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
        />
      </Field>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={scaleName}>Scale</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums">{scale}%</span>
            {scale === BRAND_SCALE_DEFAULT ? null : (
              <button
                type="button"
                onClick={() => setScale(BRAND_SCALE_DEFAULT)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                Reset
              </button>
            )}
          </div>
        </div>

        <input
          id={scaleName}
          name={scaleName}
          type="range"
          min={BRAND_SCALE_MIN}
          max={BRAND_SCALE_MAX}
          step={BRAND_SCALE_STEP}
          value={scale}
          onChange={(event) => setScale(Number(event.target.value))}
          className="h-6 w-full accent-[var(--color-primary)]"
        />

        <p className="text-xs tabular-nums text-muted-foreground">
          {surfaces
            .map((one) => `${brandSize(one.base, scale)}px ${one.where}`)
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
            url={trimmed}
            px={previewPx}
            shape={shape}
            invert={false}
          />
          <PreviewTile
            theme="light"
            caption={invertsOnLight ? "Light theme · inverted" : "Light theme"}
            url={trimmed}
            px={previewPx}
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
  url,
  px,
  shape,
  invert,
}: {
  theme: "dark" | "light";
  caption: string;
  url: string;
  px: number;
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
      <div className="flex min-h-20 items-center justify-center">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            style={
              shape === "square" ? { width: px, height: px } : { height: px }
            }
            className={cn("max-w-full object-contain", invert && "invert")}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Nothing set</span>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground">{caption}</span>
    </div>
  );
}
