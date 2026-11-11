import "dotenv/config";
import { chromium, type Locator, type Page } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdir } from "node:fs/promises";
import { db } from "@/lib/db";

/**
 * Every switch in the app, photographed where it lives.
 *
 * Tabs, segmented controls, chips and option buttons were each built where
 * they were needed, and look it. This finds each one on its own page — as the
 * person who sees it, after whatever taps it takes to get there — and saves a
 * picture of it with a little of the page around it, in both themes, so they
 * can be laid side by side and one look chosen.
 *
 *   . scripts/ui-audit/env.sh
 *   npx tsx --tsconfig tsconfig.json scripts/ui-audit/controls.ts [out-dir] [width]
 *
 * Writes <out-dir>/<key>-<theme>.png; prints one line per control.
 */

// Signs people in and presses buttons, so it is kept to the audit database.
if (!/quicktec_audit/.test(process.env.DATABASE_URL ?? "")) {
  console.error(
    "Refusing to run: DATABASE_URL is not the audit database. Source scripts/ui-audit/env.sh first.",
  );
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.argv[2] ?? ".audit/shots/controls";
const WIDTH = Number(process.argv[3] ?? 390);
const PAD = 12;

type Who = "tech" | "boss" | "admin";

const EMAILS: Record<Who, string> = {
  tech: "tech@417group.org",
  boss: "boss@417group.org",
  admin: "admin@417group.org",
};

type Control = {
  key: string;
  who: Who;
  path: string;
  /** Taps to get the control on screen. */
  steps?: (page: Page) => Promise<void>;
  find: (page: Page) => Locator;
};

async function main() {
  await mkdir(OUT, { recursive: true });

  const tech = await db.user.findUniqueOrThrow({ where: { email: EMAILS.tech } });
  const inProgress = await db.job.findFirstOrThrow({
    where: {
      lifecycle: "IN_PROGRESS",
      assignments: {
        some: { userId: tech.id, visits: { some: { clockOutAt: null } } },
      },
    },
    select: { id: true },
  });
  const scheduled = await db.job.findFirstOrThrow({
    where: {
      lifecycle: "SCHEDULED",
      assignments: { some: { userId: tech.id, visits: { none: {} } } },
    },
    select: { id: true },
  });
  const project = await db.project.findFirstOrThrow({
    where: { code: "SBX-POS" },
    select: { id: true },
  });

  const parent = (locator: Locator) => locator.locator("xpath=..");

  const controls: Control[] = [
    // --- moving between views of the same thing -------------------------------
    {
      key: "v1-jobs",
      who: "tech",
      path: "/jobs",
      find: (page) => parent(page.locator('a[href="/jobs?filter=revisit"]')),
    },
    {
      key: "v2-job-page",
      who: "tech",
      path: `/jobs/${inProgress.id}`,
      find: (page) => page.locator('[role="tablist"][aria-label="Job"]'),
    },
    {
      key: "v3-pay",
      who: "tech",
      path: "/pay",
      find: (page) => parent(page.getByRole("link", { name: "Weekly", exact: true })),
    },
    {
      key: "v4-approvals",
      who: "boss",
      path: "/approvals",
      find: (page) => parent(page.locator('a[href="/approvals?tab=outgoing"]')),
    },
    {
      key: "v5-project-jobs",
      who: "boss",
      path: `/projects/${project.id}`,
      find: (page) => parent(page.getByRole("button", { name: /^All\s*\d+$/ })),
    },
    {
      key: "v6-new-job",
      who: "boss",
      path: "/jobs/new",
      find: (page) => page.locator('[role="tablist"][aria-label="Start from"]'),
    },
    {
      key: "v7-scope-editor",
      who: "boss",
      path: `/projects/${project.id}/settings`,
      find: (page) => page.locator('[role="tablist"][aria-label="Scope editor"]'),
    },
    {
      key: "v8-roles",
      // A manager's page: an administrator is sent to the dashboard.
      who: "boss",
      path: "/settings/roles",
      find: (page) => page.locator('nav[aria-label="Roles and permissions"]'),
    },
    // --- narrowing what is shown -----------------------------------------------
    {
      key: "f1-statistics",
      who: "tech",
      path: "/pay/stats",
      find: (page) => page.locator('nav[aria-label="Period"]'),
    },
    // --- picking one value for a form ------------------------------------------
    {
      key: "c1-checkout-outcome",
      who: "tech",
      path: `/jobs/${inProgress.id}`,
      steps: async (page) => {
        await page.getByRole("button", { name: "Clock out", exact: true }).click();
        await page.getByRole("button", { name: /^Continue/ }).click();
      },
      find: (page) => parent(page.getByRole("button", { name: "Incomplete", exact: true })),
    },
    {
      key: "c2-clock-picker",
      who: "tech",
      path: `/jobs/${scheduled.id}`,
      steps: async (page) => {
        await page.getByRole("button", { name: "Clock in", exact: true }).click();
      },
      find: (page) => page.locator("div.grid.grid-cols-5").first(),
    },
    {
      key: "c3-estimate-presets",
      who: "boss",
      path: `/jobs/${inProgress.id}/manage/schedule`,
      find: (page) => parent(page.getByRole("button", { name: "8h", exact: true })),
    },
    {
      key: "c4-break-pay",
      who: "boss",
      path: `/jobs/${inProgress.id}`,
      steps: async (page) => {
        await page.locator("summary", { hasText: "Time & schedule" }).first().click();
      },
      find: (page) => page.locator('[role="radiogroup"][aria-label="Breaks"]'),
    },
    {
      key: "c5-theme",
      who: "tech",
      path: "/account",
      find: (page) => page.locator('[role="radiogroup"][aria-label="Theme"]'),
    },
  ];

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  for (const who of ["tech", "boss", "admin"] as Who[]) {
    const user = await db.user.findUniqueOrThrow({ where: { email: EMAILS[who] } });
    const token = await encode({
      token: { sub: user.nextcloudSub ?? user.id, userId: user.id },
      secret: process.env.AUTH_SECRET!,
      salt: "authjs.session-token",
      maxAge: 3600,
    });

    for (const theme of ["dark", "light"]) {
      const context = await browser.newContext({
        viewport: { width: WIDTH, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: WIDTH < 768,
        isMobile: WIDTH < 768,
        timezoneId: "America/Los_Angeles",
        locale: "en-US",
      });
      await context.addCookies([
        { name: "authjs.session-token", value: token, url: BASE },
      ]);
      await context.addInitScript("window.__name = (fn) => fn;");
      await context.addInitScript(
        `try { localStorage.setItem("quicktec-theme", ${JSON.stringify(theme)}); } catch {}`,
      );

      for (const control of controls.filter((one) => one.who === who)) {
        const page = await context.newPage();
        const file = `${OUT}/${control.key}-${theme}.png`;
        try {
          await page.goto(`${BASE}${control.path}`, { waitUntil: "load" });
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
          if (control.steps) {
            await control.steps(page);
            await page.waitForTimeout(500);
          }
          // The tab bar is fixed to the bottom of the screen and would sit
          // across whatever is photographed under it.
          await page.addStyleTag({ content: "nav.fixed { display: none !important; }" });
          const target = control.find(page).first();
          await target.scrollIntoViewIfNeeded({ timeout: 8_000 });
          const box = await target.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return {
              x: rect.left + window.scrollX,
              y: rect.top + window.scrollY,
              width: rect.width,
              height: rect.height,
              page: document.documentElement.scrollWidth,
            };
          });
          const x = Math.max(0, box.x - PAD);
          await page.screenshot({
            path: file,
            fullPage: true,
            clip: {
              x,
              y: Math.max(0, box.y - PAD),
              width: Math.min(box.page - x, box.width + PAD * 2),
              height: box.height + PAD * 2,
            },
          });
          console.log(`ok   ${control.key} ${theme} ${Math.round(box.width)}x${Math.round(box.height)}`);
        } catch (error) {
          console.log(
            `FAIL ${control.key} ${theme}: ${(error as Error).message.split("\n")[0].slice(0, 160)}`,
          );
        }
        await page.close();
      }
      await context.close();
    }
  }

  await browser.close();
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
