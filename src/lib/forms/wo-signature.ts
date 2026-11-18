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
export async function signatureInk(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 })
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

    const rgba = Buffer.alloc(cropWidth * cropHeight * 4);
    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        // Black ink: the colour of every pen a signature is expected in.
        rgba[(y * cropWidth + x) * 4 + 3] = alpha[(top + y) * width + (left + x)];
      }
    }

    const png = await sharp(rgba, { raw: { width: cropWidth, height: cropHeight, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return new Uint8Array(png);
  } catch (error) {
    console.error("[work order] the signature file could not be read", error);
    return null;
  }
}
