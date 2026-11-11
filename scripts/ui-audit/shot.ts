import "dotenv/config";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { db } from "@/lib/db";

/**
 * One screen, as one person, after a few taps.
 *
 *   tsx --tsconfig tsconfig.json scripts/ui-audit/shot.ts <role|email> <view> <theme> <path> <out.png> [step ...]
 *
 * Steps run in order:
 *   click:<css>          tap the first match
 *   text:<visible text>  tap the first element with exactly that text
 *   has:<visible text>   tap the first element containing that text
 *   role:<role>=<name>   tap by ARIA role and accessible name (regex, case-insensitive)
 *   fill:<css>==<value>  type into a field
 *   files:<css>==<a,b>   choose files in a file input
 *   tab:<name>           open a tab by the start of its name
 *   wait:<ms>
 *   shot:<file.png>      an extra screenshot here (viewport)
 *   full:<file.png>      an extra screenshot here (whole page)
 *   scroll:<css>         bring an element to the top
 *   eval:<js>            run in the page, print the result
 * The last screenshot (<out.png>) is the whole page unless the path ends in "-fold.png".
 * SCALE=2 in the environment takes it at twice the pixels.
 */

// Signs people in and presses buttons, so it is kept to the audit database:
// pointed at a real one it would clock somebody in.
if (!/quicktec_audit/.test(process.env.DATABASE_URL ?? "")) {
  console.error(
    "Refusing to run: DATABASE_URL is not the audit database. Source scripts/ui-audit/env.sh first.",
  );
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  small: { width: 320, height: 568 },
  // The two most common Android and small-iPhone widths, between the two above.
  w360: { width: 360, height: 780 },
  w375: { width: 375, height: 667 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};

const EMAILS: Record<string, string> = {
  tech: "tech@417group.org",
  tech2: "tech2@417group.org",
  sup: "sup@417group.org",
  boss: "boss@417group.org",
  admin: "admin@417group.org",
};

async function main() {
  const [who, view, theme, path, out, ...steps] = process.argv.slice(2);
  const email = EMAILS[who] ?? who;
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const token = await encode({
    token: { sub: user.nextcloudSub ?? user.id, userId: user.id },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const phone = view === "phone" || view === "small" || view.startsWith("w");
  const context = await browser.newContext({
    viewport: VIEWPORTS[view],
    // SCALE=2 for a picture somebody will look at on a phone; 1 for checks.
    deviceScaleFactor: Number(process.env.SCALE ?? 1),
    hasTouch: phone,
    isMobile: phone,
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  });
  await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE }]);
  await context.addInitScript("window.__name = (fn) => fn;");
  await context.addInitScript(
    `try { localStorage.setItem("quicktec-theme", ${JSON.stringify(theme)}); } catch {}`,
  );

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`console: ${message.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => console.log(`pageerror: ${error.message.slice(0, 300)}`));

  const response = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  console.log(`${response?.status()} ${page.url().replace(BASE, "")}`);

  await mkdir(dirname(out), { recursive: true });

  for (const step of steps) {
    const at = step.indexOf(":");
    const kind = at > -1 ? step.slice(0, at) : step;
    const rest = at > -1 ? step.slice(at + 1) : "";
    try {
      if (kind === "click") await page.locator(rest).first().click({ timeout: 5_000 });
      else if (kind === "text") await page.getByText(rest, { exact: true }).first().click({ timeout: 5_000 });
      else if (kind === "has") await page.getByText(rest).first().click({ timeout: 5_000 });
      else if (kind === "role") {
        const eq = rest.indexOf("=");
        await page
          .getByRole(rest.slice(0, eq) as "button", { name: new RegExp(rest.slice(eq + 1), "i") })
          .first()
          .click({ timeout: 5_000 });
      } else if (kind === "fill") {
        const eq = rest.indexOf("==");
        await page.locator(rest.slice(0, eq)).first().fill(rest.slice(eq + 2), { timeout: 5_000 });
      } else if (kind === "files") {
        const eq = rest.indexOf("==");
        await page.locator(rest.slice(0, eq)).first().setInputFiles(rest.slice(eq + 2).split(","));
      } else if (kind === "tab") {
        await page.getByRole("tab", { name: new RegExp(`^${rest}`) }).click({ timeout: 5_000 });
      } else if (kind === "wait") await page.waitForTimeout(Number(rest));
      else if (kind === "shot") {
        await page.waitForTimeout(300);
        await page.screenshot({ path: rest });
      } else if (kind === "full") {
        await page.waitForTimeout(300);
        await page.screenshot({ path: rest, fullPage: true });
      } else if (kind === "scroll") {
        await page.locator(rest).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      } else if (kind === "eval") {
        console.log(`eval: ${JSON.stringify(await page.evaluate(rest))}`);
      } else console.log(`unknown step ${step}`);
      if (kind !== "wait" && kind !== "shot" && kind !== "full" && kind !== "eval") {
        await page.waitForTimeout(250);
      }
    } catch (error) {
      console.log(`FAIL ${step}: ${(error as Error).message.split("\n")[0].slice(0, 200)}`);
    }
  }

  await page.waitForTimeout(300);
  await page.screenshot({ path: out, fullPage: !out.endsWith("-fold.png") });
  console.log(`shot ${out}`);

  await browser.close();
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
