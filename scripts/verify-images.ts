import "dotenv/config";
import sharp from "sharp";
import { processImage, stampLayers, watermarkText } from "@/lib/images";

/**
 * Checks that a photo comes out of the pipeline carrying its stamp.
 *
 * By reading the pixels, not by checking that the code ran. The bug this was
 * written for produced a perfectly good JPEG with a black plate in the corner
 * and nothing written on it: the runtime image ships no fonts, an SVG <text>
 * had nothing to render in, and every other check still passed. A photo
 * without its stamp is a photo that cannot be tied to a job or a day, and
 * nobody notices while they are working.
 *
 * Non-destructive, needs no database.
 *
 *   npm run verify:images
 */

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `\n      got ${actual}\n     want ${expected}`),
  );
}

function ok(label: string, condition: boolean) {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
}

/** A plain grey photo, so anything drawn on it is unambiguous. */
async function photo(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .jpeg()
    .toBuffer();
}

/** How much of a region is near-white — i.e. how much of it is the label. */
async function whiteFraction(
  image: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const { data } = await sharp(image)
    .extract(region)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let light = 0;
  for (const value of data) if (value > 200) light++;
  return light / data.length;
}

async function main() {
  console.log("\n--- the stamp ---");

  const text = watermarkText({
    date: "2026-06-25",
    assignmentId: "A-88231",
    customerCode: "TSA",
    siteNumber: "4471",
  });
  check("the stamp reads as agreed", text, "2026-06-25-A-88231-TSA-#4471");
  check(
    "a job with no assignment id still gets one",
    watermarkText({
      date: "2026-06-25",
      assignmentId: null,
      customerCode: "TSA",
      siteNumber: "4471",
    }),
    "2026-06-25-NO-AID-TSA-#4471",
  );

  const layers = await stampLayers(text, 1600, 1200);
  check("a plate and a label", layers.length, 2);

  // The label is drawn from the font the app ships. If that ever falls back to
  // a system font that is not there, this is an empty image.
  const label = await sharp(layers[1].input).metadata();
  ok(`the label has real size (${label.width}x${label.height})`, (label.width ?? 0) > 100 && (label.height ?? 0) > 8);

  console.log("\n--- a photo through the pipeline ---");

  const stamped = await processImage(await photo(1600, 1200), "image/jpeg", text);
  check("comes back as a jpeg", stamped.mimeType, "image/jpeg");
  check("keeps its size", `${stamped.width}x${stamped.height}`, "1600x1200");
  check("and says it was stamped", stamped.watermarked, true);

  // The bottom-right corner, where the stamp goes.
  const corner = { left: 1600 - 520, top: 1200 - 120, width: 500, height: 100 };
  const stampedWhite = await whiteFraction(stamped.data, corner);
  const plain = await processImage(await photo(1600, 1200), "image/jpeg", null);
  const plainWhite = await whiteFraction(plain.data, corner);

  check("an unstamped photo has nothing in that corner", plainWhite < 0.001, true);
  ok(
    `the stamp writes light pixels there (${(stampedWhite * 100).toFixed(2)}% of the corner)`,
    stampedWhite > 0.01,
  );

  // The failure this was written for: a plate with no text on it. Dark pixels
  // where the grey photo was, and no light ones at all.
  const darkFraction = await (async () => {
    const { data } = await sharp(stamped.data)
      .extract(corner)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (const value of data) if (value < 90) dark++;
    return dark / data.length;
  })();
  ok(`the plate is drawn too (${(darkFraction * 100).toFixed(1)}% dark)`, darkFraction > 0.05);
  ok("and it is not an empty plate", stampedWhite / darkFraction > 0.02);

  console.log("\n--- a small photo ---");

  // A screenshot from a phone, where a stamp sized for a 4032px photo would
  // cover the picture.
  const small = await processImage(await photo(640, 480), "image/jpeg", text);
  check("is stamped as well", small.watermarked, true);
  const smallLayers = await stampLayers(text, 640, 480);
  const plate = await sharp(smallLayers[0].input).metadata();
  ok(
    `and the stamp still fits inside it (${plate.width}x${plate.height})`,
    (plate.width ?? 0) < 640 && (plate.height ?? 0) < 480,
  );
  ok("sitting inside the frame", smallLayers[0].left >= 0 && smallLayers[0].top >= 0);

  console.log("\n--- what must not be stamped ---");

  const pdf = Buffer.from("%PDF-1.4\n%stub\n");
  const passed = await processImage(pdf, "application/pdf", text);
  check("a pdf goes through untouched", passed.data.equals(pdf), true);
  check("and is never stamped", passed.watermarked, false);

  console.log(
    failures === 0 ? "\nAll image checks passed." : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
