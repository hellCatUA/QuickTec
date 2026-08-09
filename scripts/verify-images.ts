import "dotenv/config";
import sharp from "sharp";
import {
  stampOrNothing,
  looksLikeImage,
  probeImagePipeline,
  processImage,
  stampHasInk,
  stampLayers,
  watermarkText,
} from "@/lib/images";

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

  console.log("\n--- a photo is never lost to its stamp ---");
  //
  // A libvips built without pango throws where the label is drawn. That took
  // the whole upload down with it, and told the tech to retake a photo that
  // was never the problem. The renderer is injected because that failure
  // cannot be provoked through sharp on a build where text works.
  const refused = await stampOrNothing(text, 1600, 1200, async () => {
    throw new Error("pango: no font could be loaded");
  });
  check("a stamp that cannot be drawn is nothing, not a throw", refused, null);
  // The photo is composited only when there are layers, so nothing is lost and
  // nothing claims a stamp that is not on the picture.
  ok("while one that can be drawn comes back", (await stampOrNothing(text, 1600, 1200)) !== null);

  console.log("\n--- telling a bad file from a bad server ---");

  ok("a JPEG is recognised from its bytes", looksLikeImage(await photo(64, 48)));
  ok(
    "a QuickTime video is not",
    !looksLikeImage(
      Buffer.concat([Buffer.alloc(4), Buffer.from("ftypqt  ", "latin1")]),
    ),
  );
  ok("nor is a text file", !looksLikeImage(Buffer.from("hello there")));
  // An iPhone sending application/octet-stream still has to be let through.
  ok(
    "a HEIC is, whatever it calls itself",
    looksLikeImage(
      Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic", "latin1"), Buffer.alloc(8)]),
    ),
  );

  // The bug that shipped once: the plate drew, the label did not, and every
  // photo went into the record with a black box where the job should be.
  ok("the stamp comes out with ink in it", await stampHasInk());

  const probe = await probeImagePipeline();
  check("the pipeline reports itself working here", probe.ok, true);
  // Printed rather than asserted: what libvips was built with varies by
  // machine, and none of it stops a photo storing.
  for (const note of probe.notes) console.log(`      note: ${note}`);

  console.log("\n--- how long a tech waits ---");
  //
  // A 12MP photo used to take three and a half seconds here, most of it spent
  // encoding a JPEG that was immediately thrown away: the resize was compressed
  // once to learn its dimensions, decoded again to draw the stamp on, and
  // compressed a second time. It is now decoded once and compressed once.
  //
  // The bound is loose on purpose — this runs on whatever machine happens to
  // be to hand — but a second per photo is far enough above what it costs to
  // catch the double encode coming back, and far below what a person notices.
  const big = await sharp({
    create: { width: 4032, height: 3024, channels: 3, background: "#3a6ea5" },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  const started = performance.now();
  const processed = await processImage(big, "image/jpeg", text);
  const took = performance.now() - started;

  check("a 12MP photo comes out at 2400px", `${processed.width}x${processed.height}`, "2400x1800");
  ok(`and takes ${took.toFixed(0)} ms, not seconds`, took < 1000);

  console.log("\n--- a photo the phone shrank before sending ---");
  //
  // The browser re-encodes to the size the server would have kept anyway,
  // which drops the EXIF with the pixels. The timestamp and the GPS fix are
  // the only evidence a photo was taken on site rather than in a car park
  // afterwards, so the head of the original travels with it and is read here.
  const original = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: "#456" },
  })
    .withExif({ IFD2: { DateTimeOriginal: "2026:08:09 11:55:03" } })
    .jpeg({ quality: 90 })
    .toBuffer();

  // What the browser sends: no metadata at all.
  const shrunk = await sharp(original)
    .resize({ width: 2400 })
    .jpeg({ quality: 85 })
    .toBuffer();
  check(
    "the shrunk photo carries no EXIF of its own",
    (await sharp(shrunk).metadata()).exif === undefined,
    true,
  );

  const withoutHead = await processImage(shrunk, "image/jpeg", null);
  check("so on its own the capture time is lost", withoutHead.capturedAt, null);

  const head = original.subarray(0, 64 * 1024);
  const withHead = await processImage(shrunk, "image/jpeg", null, head);
  check(
    "and comes back when the head of the original comes too",
    withHead.capturedAt?.toISOString().slice(0, 10),
    "2026-08-09",
  );

  // The original still answers for itself; the head is only a fallback.
  check(
    "a full-size original still reads its own",
    (await processImage(original, "image/jpeg", null)).capturedAt
      ?.toISOString()
      .slice(0, 10),
    "2026-08-09",
  );

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
