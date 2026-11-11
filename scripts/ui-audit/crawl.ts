import "dotenv/config";
import { chromium, type BrowserContext, type Page } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "@/lib/db";

/**
 * Walks every screen as each kind of user, at phone and desktop width, and
 * writes down what a person would trip over: errors in the console, requests
 * that failed, content wider than the screen, controls too small to tap, text
 * cut off. Screenshots go beside the report, sliced so each is readable.
 *
 *   tsx --tsconfig tsconfig.json scripts/ui-audit/crawl.ts [--roles tech,boss] [--views phone,desktop]
 *       [--themes dark,light] [--only /jobs] [--out .audit/shots/run1]
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const ROLES = arg("roles", "tech,sup,boss,admin").split(",");
const VIEWS = arg("views", "phone,desktop").split(",");
const THEMES = arg("themes", "dark").split(",");
const ONLY = arg("only", "");
const OUT = arg("out", ".audit/shots/run");
const SLICE = Number(arg("slice", "1500"));

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  small: { width: 320, height: 568 },
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

type Finding = {
  role: string;
  view: string;
  theme: string;
  route: string;
  url: string;
  status: number | null;
  finalUrl: string;
  title: string;
  h1: string[];
  height: number;
  overflowX: number;
  wide: string[];
  smallTargets: string[];
  clipped: string[];
  brokenImages: string[];
  splitText: string[];
  blownGrids?: string[];
  consoleErrors: string[];
  failedRequests: string[];
  shots: string[];
};

async function routesFor(role: string): Promise<{ name: string; path: string }[]> {
  const job = await db.job.findFirst({
    where: { title: "Elevator phone line" },
    select: { id: true, siteId: true, projectId: true, customerId: true, clientId: true },
  });
  const anyProject = await db.project.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  const tech = await db.user.findUnique({ where: { email: EMAILS.tech }, select: { id: true } });
  const boss = await db.user.findUnique({ where: { email: EMAILS.boss }, select: { id: true } });
  const template = await db.clientDocumentTemplate.findFirst({ select: { id: true, clientId: true } });

  const jobId = job?.id ?? "missing";
  const projectId = job?.projectId ?? anyProject?.id ?? "missing";

  const routes: { name: string; path: string }[] = [
    { name: "dashboard", path: "/dashboard" },
    { name: "jobs", path: "/jobs" },
    { name: "jobs-new", path: "/jobs/new" },
    { name: "job", path: `/jobs/${jobId}` },
    { name: "job-edit", path: `/jobs/${jobId}/edit` },
    { name: "job-manage", path: `/jobs/${jobId}/manage` },
    { name: "job-manage-job", path: `/jobs/${jobId}/manage/job` },
    { name: "job-manage-schedule", path: `/jobs/${jobId}/manage/schedule` },
    { name: "job-review", path: `/jobs/${jobId}/review` },
    { name: "job-revisit", path: `/jobs/${jobId}/revisit` },
    { name: "projects", path: "/projects" },
    { name: "project", path: `/projects/${projectId}` },
    { name: "project-settings", path: `/projects/${projectId}/settings` },
    { name: "approvals", path: "/approvals" },
    { name: "mileage", path: "/mileage" },
    { name: "pay", path: "/pay" },
    { name: "pay-stats", path: "/pay/stats" },
    { name: "payroll", path: "/payroll" },
    { name: "payroll-user", path: `/payroll/${tech?.id ?? "missing"}` },
    { name: "payroll-rates", path: "/payroll/rates" },
    { name: "directory", path: "/directory" },
    { name: "directory-clients", path: "/directory/clients" },
    { name: "directory-customers", path: "/directory/customers" },
    { name: "directory-customer", path: `/directory/customers/${job?.customerId ?? "missing"}` },
    { name: "directory-reps", path: "/directory/rep-companies" },
    { name: "site", path: `/sites/${job?.siteId ?? "missing"}` },
    { name: "people", path: "/people" },
    { name: "person-tech", path: `/people/${tech?.id ?? "missing"}` },
    { name: "person-boss", path: `/people/${boss?.id ?? "missing"}` },
    { name: "account", path: "/account" },
    { name: "more", path: "/more" },
    { name: "settings", path: "/settings" },
    { name: "settings-company", path: "/settings/company" },
    { name: "settings-users", path: "/settings/users" },
    { name: "settings-roles", path: "/settings/roles" },
    { name: "settings-integrations", path: "/settings/integrations" },
  ];
  if (template) {
    routes.push({
      name: "form-mapper",
      path: `/directory/clients/${template.clientId}/forms/${template.id}`,
    });
    routes.push({ name: "job-sign-off", path: `/jobs/${jobId}/sign-off/${template.id}` });
  }

  // One job at each stage, the tech's own where there is one.
  for (const lifecycle of [
    "IN_PROGRESS",
    "PENDING_APPROVAL",
    "PENDING_REVIEW",
    "CHANGES_REQUESTED",
    "APPROVED",
    "BILLED",
    "REJECTED",
  ] as const) {
    const staged =
      (await db.job.findFirst({
        where: { lifecycle, assignments: { some: { userId: tech?.id } } },
        orderBy: { scheduledStart: "desc" },
        select: { id: true },
      })) ??
      (await db.job.findFirst({ where: { lifecycle }, select: { id: true } }));
    if (!staged) continue;
    const slug = lifecycle.toLowerCase().replace(/_/g, "-");
    routes.push({ name: `job-${slug}`, path: `/jobs/${staged.id}` });
    if (lifecycle === "IN_PROGRESS" || lifecycle === "PENDING_REVIEW") {
      routes.push({ name: `job-${slug}-manage`, path: `/jobs/${staged.id}/manage` });
      routes.push({ name: `job-${slug}-schedule`, path: `/jobs/${staged.id}/manage/schedule` });
      routes.push({ name: `job-${slug}-review`, path: `/jobs/${staged.id}/review` });
    }
  }
  const sbxProject = await db.project.findFirst({ where: { code: "SBX-POS" }, select: { id: true } });
  if (sbxProject) {
    routes.push({ name: "project-pos", path: `/projects/${sbxProject.id}` });
    routes.push({ name: "project-pos-settings", path: `/projects/${sbxProject.id}/settings` });
  }
  void role;
  if (!ONLY) return routes;
  const wanted = ONLY.split(",");
  return routes.filter((route) =>
    wanted.some((one) => (one.startsWith("/") ? route.path.startsWith(one) : route.name.startsWith(one))),
  );
}

/** Everything measured inside the page, in one round trip. */
async function measure(page: Page, phone: boolean) {
  return page.evaluate((isPhone) => {
    const doc = document.documentElement;
    const viewportWidth = doc.clientWidth;

    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const label =
        el.getAttribute("aria-label") ||
        (el as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 40) ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.getAttribute("placeholder") ||
        "";
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".");
      return `${tag}${cls ? "." + cls : ""} "${label}"`;
    };

    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      // Inside a closed <details>, or a hidden ancestor.
      let node: Element | null = el;
      while (node) {
        const s = getComputedStyle(node);
        if (s.display === "none" || s.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };

    /** Scrolls sideways on purpose: a table in an overflow-x container. */
    const insideScroller = (el: Element): boolean => {
      let node: Element | null = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (/(auto|scroll)/.test(s.overflowX) && node.scrollWidth > node.clientWidth) return true;
        node = node.parentElement;
      }
      return false;
    };

    const wide: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (wide.length >= 8) break;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.right > viewportWidth + 1 && visible(el) && !insideScroller(el)) {
        // Only the outermost offender of a chain is interesting.
        const parent = el.parentElement;
        if (parent && parent !== document.body && parent.getBoundingClientRect().right > viewportWidth + 1) continue;
        wide.push(`${describe(el)} right=${Math.round(rect.right)}`);
      }
    }

    const smallTargets: string[] = [];
    if (isPhone) {
      const interactive = Array.from(
        document.querySelectorAll(
          'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="menuitem"], [role="switch"]',
        ),
      );
      for (const el of interactive) {
        if (smallTargets.length >= 25) break;
        if (!visible(el)) continue;
        const rect = el.getBoundingClientRect();
        // A checkbox or radio inside a label borrows the label's box.
        let box = rect;
        const label = el.closest("label");
        if (label) box = label.getBoundingClientRect();
        // A link in running text is not a button; skip it.
        const style = getComputedStyle(el);
        if (el.tagName === "A" && style.display === "inline" && el.parentElement && (el.parentElement as HTMLElement).innerText.trim().length > (el as HTMLElement).innerText.trim().length + 12) continue;
        if (box.height < 40 || box.width < 40) {
          smallTargets.push(`${describe(el)} ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }
    }

    const clipped: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (clipped.length >= 15) break;
      const style = getComputedStyle(el);
      if (style.textOverflow !== "ellipsis" && !/(hidden|clip)/.test(style.overflowX)) continue;
      if ((el as HTMLElement).children.length > 3) continue;
      if (el.scrollWidth > el.clientWidth + 1 && visible(el) && (el as HTMLElement).innerText?.trim()) {
        clipped.push(`${describe(el)} ${el.clientWidth}/${el.scrollWidth}`);
      }
    }

    // A sentence set loose in a flex row: each run of text between two
    // elements becomes a column of its own.
    const splitText: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (splitText.length >= 10) break;
      const style = getComputedStyle(el);
      if (!/flex|grid/.test(style.display)) continue;
      if (style.display.includes("flex") && style.flexDirection.startsWith("column")) continue;
      // Text nodes with only comments between them lay out as one item; it
      // takes an element in between to make two columns of a sentence.
      let runs = 0;
      let inRun = false;
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3) {
          if ((node.textContent ?? "").trim().length > 1 && !inRun) {
            runs++;
            inRun = true;
          }
        } else if (node.nodeType === 1) {
          inRun = false;
        }
      }
      if (runs >= 2 && visible(el)) splitText.push(describe(el));
    }

    // A grid column that grew to fit something unbreakable: its children end
    // past the grid's own edge, whether or not the page scrolls sideways.
    const blownGrids: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (blownGrids.length >= 8) break;
      if (!getComputedStyle(el).display.includes("grid")) continue;
      if (!visible(el)) continue;
      const box = el.getBoundingClientRect();
      for (const child of Array.from(el.children)) {
        const inner = child.getBoundingClientRect();
        if (inner.width > 0 && inner.right > box.right + 2) {
          blownGrids.push(`${describe(el)} child +${Math.round(inner.right - box.right)}px`);
          break;
        }
      }
    }

    const brokenImages = Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth === 0 && visible(img))
      .map((img) => img.getAttribute("src") ?? "")
      .slice(0, 8);

    return {
      title: document.title,
      h1: Array.from(document.querySelectorAll("h1")).map((h) => (h as HTMLElement).innerText.trim()),
      height: doc.scrollHeight,
      overflowX: doc.scrollWidth - doc.clientWidth,
      wide,
      smallTargets,
      clipped,
      brokenImages,
      splitText,
      blownGrids,
    };
  }, phone);
}

async function visit(
  context: BrowserContext,
  meta: { role: string; view: string; theme: string },
  route: { name: string; path: string },
  dir: string,
): Promise<Finding> {
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.request().method()} ${response.url().replace(BASE, "")}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    // Navigations abort prefetches all the time; that is not a failure.
    if (/ERR_ABORTED/.test(failure)) return;
    failedRequests.push(`failed ${request.method()} ${request.url().replace(BASE, "")} ${failure}`);
  });

  const url = `${BASE}${route.path}`;
  let status: number | null = null;
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    status = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(250);
  } catch (error) {
    consoleErrors.push(`navigation: ${(error as Error).message.slice(0, 200)}`);
  }

  const phone = meta.view === "phone" || meta.view === "small";
  const measured = await measure(page, phone).catch((error) => ({
    title: "",
    h1: [],
    height: 0,
    overflowX: 0,
    wide: [`measure failed: ${(error as Error).message.slice(0, 120)}`],
    smallTargets: [],
    clipped: [],
    brokenImages: [],
    splitText: [],
  }));

  const shots: string[] = [];
  const viewport = VIEWPORTS[meta.view];

  // What is on screen before anybody scrolls, tab bar and all.
  if (phone) {
    await page.screenshot({ path: `${dir}/${route.name}--fold.png` }).catch(() => {});
    // The slices are for reading the page; a fixed bar would sit across each.
    await page.addStyleTag({ content: "nav.fixed { display: none !important; }" }).catch(() => {});
  }
  const total = Math.max(measured.height, viewport.height);
  const slices = Math.min(Math.ceil(total / SLICE), 8);
  for (let index = 0; index < slices; index++) {
    const y = index * SLICE;
    const height = Math.min(SLICE, total - y);
    if (height < 40) break;
    const file = `${dir}/${route.name}${slices > 1 ? `-${index + 1}` : ""}.png`;
    await page
      .screenshot({
        path: file,
        fullPage: true,
        clip: { x: 0, y, width: viewport.width, height },
      })
      .then(() => shots.push(file))
      .catch(() => {});
  }

  const finding: Finding = {
    ...meta,
    route: route.name,
    url: route.path,
    status,
    finalUrl: page.url().replace(BASE, ""),
    ...measured,
    consoleErrors,
    failedRequests,
    shots,
  };
  await page.close();
  return finding;
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const findings: Finding[] = [];

  for (const role of ROLES) {
    const user = await db.user.findUnique({ where: { email: EMAILS[role] } });
    if (!user) {
      console.error(`no fixture user for ${role}`);
      continue;
    }
    const token = await encode({
      token: { sub: user.nextcloudSub ?? user.id, userId: user.id },
      secret: process.env.AUTH_SECRET!,
      salt: "authjs.session-token",
      maxAge: 3600,
    });
    const routes = await routesFor(role);

    for (const view of VIEWS) {
      for (const theme of THEMES) {
        const dir = `${OUT}/${view}-${theme}-${role}`;
        await mkdir(dir, { recursive: true });
        const context = await browser.newContext({
          viewport: VIEWPORTS[view],
          deviceScaleFactor: 1,
          hasTouch: view === "phone" || view === "small",
          isMobile: view === "phone" || view === "small",
          timezoneId: "America/Los_Angeles",
          locale: "en-US",
        });
        await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE }]);
        // tsx wraps named functions in a helper that does not exist in the page.
        await context.addInitScript("window.__name = (fn) => fn;");
        await context.addInitScript(`try { localStorage.setItem("quicktec-theme", ${JSON.stringify(theme)}); } catch {}`);

        for (const route of routes) {
          const finding = await visit(context, { role, view, theme }, route, dir);
          findings.push(finding);
          const flags = [
            finding.status && finding.status >= 400 ? `HTTP ${finding.status}` : "",
            finding.finalUrl !== finding.url ? `-> ${finding.finalUrl}` : "",
            finding.overflowX > 0 ? `overflowX ${finding.overflowX}` : "",
            finding.consoleErrors.length ? `${finding.consoleErrors.length} console` : "",
            finding.failedRequests.length ? `${finding.failedRequests.length} failed` : "",
            finding.smallTargets.length ? `${finding.smallTargets.length} small` : "",
            finding.clipped.length ? `${finding.clipped.length} clipped` : "",
            finding.brokenImages.length ? `${finding.brokenImages.length} broken img` : "",
            finding.splitText.length ? `${finding.splitText.length} SPLIT-TEXT` : "",
            finding.blownGrids?.length ? `GRID ${finding.blownGrids.join(" | ")}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          console.log(`${view}/${theme}/${role} ${route.name.padEnd(22)} ${String(finding.height).padStart(5)}px ${flags}`);
        }
        await context.close();
      }
    }
  }

  await browser.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/report-${VIEWS.join("+")}-${ROLES.join("+")}${ONLY ? "-part" : ""}.json`, JSON.stringify(findings, null, 2));
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
