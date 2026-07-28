"use client";

import { Eraser } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * Signature capture.
 *
 * Drawn on white with black ink rather than on the app's theme: the PNG ends
 * up in a PDF and in the client's ZIP, where a signature made of light strokes
 * on a transparent background would be invisible.
 *
 * Uses pointer events so a finger, a stylus and a mouse all work through one
 * code path, and pins `touch-action: none` so dragging signs instead of
 * scrolling the page away.
 */
export function SignaturePad({
  onChange,
  height = 180,
  disabled,
}: {
  /** Fires with a PNG data URL, or null once the pad is cleared. */
  onChange: (dataUrl: string | null) => void;
  height?: number;
  disabled?: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const dirty = React.useRef(false);
  const [hasInk, setHasInk] = React.useState(false);

  const prepare = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Back the canvas at device resolution, or the line looks like a staircase
    // on a phone.
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const context = canvas.getContext("2d");
    if (!context) return;

    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111111";
  }, [height]);

  React.useEffect(() => {
    prepare();

    // Rotating the phone resizes the canvas, which clears it — redraw the
    // backing store and let the signer know they need to sign again.
    function onResize() {
      prepare();
      dirty.current = false;
      setHasInk(false);
      onChange(null);
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [prepare, onChange]);

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;

    const { x, y } = positionOf(event);
    context.beginPath();
    context.moveTo(x, y);
    // A tap with no drag still counts as a mark.
    context.lineTo(x + 0.1, y);
    context.stroke();

    dirty.current = true;
    setHasInk(true);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;

    const { x, y } = positionOf(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && dirty.current) onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    prepare();
    dirty.current = false;
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: "none" }}
        className="w-full cursor-crosshair rounded-lg border border-border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={disabled || !hasInk}
        >
          <Eraser /> Clear
        </Button>
        <span className="text-xs text-muted-foreground">
          {hasInk ? "Signed" : "Sign in the box above"}
        </span>
      </div>
    </div>
  );
}
