import sharp from "sharp";

/**
 * The customer's signature as it goes onto a work order: the ink alone, on a
 * clear ground, cut to its edges.
 *
 * The pad keeps what was drawn as the whole pad — a white picture several
 * times wider than the signature in it. Drawn onto the work order as it was,
 * the ink came out about seven millimetres long with hairline strokes, shrunk
 * with all that white to fit the row, and the white itself blanked out the
 * printed sentence over the row as soon as the row was made taller to give the
 * signature more room.
 *
 * Read with sharp, which refuses a damaged file cleanly: pdf-lib's own PNG
 * decoder spun forever on one cut short, and the screen's preview, which used
 * to hand it the stored file as it was, froze. The preview now gets this same
 * picture from the server, so what it shows is what is saved.
 *
 * Null when there is no ink to speak of — a pad saved blank — or the file
 * cannot be read.
 */
/**
 * How thick the pen was, in pixels: the middle length of the runs of ink
 * across the rows and down the columns, whichever is shorter.
 */
function strokeWidth(
  alpha: Uint8Array,
  width: number,
  box: { left: number; top: number; right: number; bottom: number },
): number {
  const runs = (across: boolean) => {
    const lengths: number[] = [];
    const outer = across ? [box.top, box.bottom] : [box.left, box.right];
    const inner = across ? [box.left, box.right] : [box.top, box.bottom];
    for (let a = outer[0]; a <= outer[1]; a++) {
      let run = 0;
      for (let b = inner[0]; b <= inner[1] + 1; b++) {
        const ink =
          b <= inner[1] && alpha[(across ? a : b) * width + (across ? b : a)] > 128;
        if (ink) run++;
        else if (run > 0) {
          lengths.push(run);
          run = 0;
        }
      }
    }
    lengths.sort((x, y) => x - y);
    return lengths.length > 0 ? lengths[Math.floor(lengths.length / 2)] : 1;
  };
  return Math.max(1, Math.min(runs(true), runs(false)));
}

export async function signatureInk(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    // A pad's picture is under a megapixel. Anything far past that is not
    // one, and a crafted one 33,000 pixels tall took a second and 300 MB of
    // the server on every look at the screen.
    const { data, info } = await sharp(bytes, { limitInputPixels: 24_000_000 })
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    // How dark each pixel is, as how much of it is ink. Paper and the faint
    // speckle a phone's pad leaves read as none; a stroke's soft edge as
    // part, so the curve stays smooth on the clear ground.
    const alpha = new Uint8Array(width * height);
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const darkness = 255 - data[index * channels];
        const ink = darkness <= 24 ? 0 : Math.min(255, Math.round(((darkness - 24) * 255) / 160));
        alpha[index] = ink;
        if (ink > 40) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;

    // A little room round the ink, so no stroke is cut flat at the edge.
    const pad = Math.max(2, Math.round(Math.max(width, height) * 0.01));
    const left = Math.max(0, x0 - pad);
    const top = Math.max(0, y0 - pad);
    const right = Math.min(width - 1, x1 + pad);
    const bottom = Math.min(height - 1, y1 + pad);
    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;

    // Never taller on the paper than a signature is: the picture is at least
    // two dozen strokes tall, clear above the ink. Cut to the ink and fitted
    // to the row, initials came out in strokes three times a pen's width and
    // a single tap as a blot the height of the row.
    const outHeight = Math.max(cropHeight, Math.round(strokeWidth(alpha, width, { left, top, right, bottom }) * 24));
    const lift = outHeight - cropHeight;

    const rgba = Buffer.alloc(cropWidth * outHeight * 4);
    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        // Black ink: the colour of every pen a signature is expected in.
        rgba[((lift + y) * cropWidth + x) * 4 + 3] = alpha[(top + y) * width + (left + x)];
      }
    }

    const png = await sharp(rgba, { raw: { width: cropWidth, height: outHeight, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return new Uint8Array(png);
  } catch (error) {
    console.error("[work order] the signature file could not be read", error);
    return null;
  }
}
